/**
 * Storage service — Phase 4.2
 *
 * Routes file bytes into GridFS across per-user Atlas M0 cluster fleet.
 * Splits files across multiple clusters when a single cluster has insufficient room.
 */
import { Readable } from 'stream';
import { Types } from 'mongoose';
import { FileModel, type IFile } from '../models/File';
import { BlobModel } from '../models/Blob';
import { StorageClusterModel } from '../models/StorageCluster';
import { getOrOpenBucket, USABLE_BYTES } from './clusterManager';
import { ensureCapacity } from './provisioner';
import { encryptBuffer, decryptBuffer, ENCRYPTION_OVERHEAD } from '../utils/crypto';
import { getUniqueName, buildPath } from '../utils/paths';

export interface StoreFileOptions {
  userId: string;
  parentId: string | null;
  name: string;
  buffer: Buffer;
  mimeType: string;
  encrypt: boolean;
  encryptionKey?: string;
}

/**
 * Write a buffer into GridFS, potentially splitting across multiple clusters.
 * Creates one Blob doc per cluster-part (index 0, 1, ...).
 * Returns the File metadata doc.
 */
export async function storeFile(opts: StoreFileOptions): Promise<IFile | null> {
  const { userId, parentId, name, buffer, mimeType, encrypt, encryptionKey } = opts;

  if (encrypt && !encryptionKey) {
    throw new Error('encryptionKey is required when encrypt is true');
  }

  // Resolve parent path from File doc (if parentId supplied)
  let parentPath: string | null = null;
  if (parentId) {
    const parentDoc = await FileModel.findById(parentId).select('path');
    parentPath = parentDoc?.path ?? null;
  }

  // Deduplicate filename within this parent scope
  const uniqueName = await getUniqueName(userId, parentPath, name);
  const filePath = buildPath(parentPath, uniqueName);

  // Create the File doc first with total (plaintext) size
  const fileDoc = await FileModel.create({
    userId: new Types.ObjectId(userId),
    parentId: parentId ? new Types.ObjectId(parentId) : null,
    name: uniqueName,
    path: filePath,
    mimeType: mimeType || 'application/octet-stream',
    size: buffer.length,
    type: 'file',
    encrypted: encrypt,
  });

  // Split payload across clusters using per-chunk (per-blob) encryption.
  // Each plaintext chunk is independently encrypted before being written to GridFS,
  // so each Blob is self-contained and can be decrypted without its neighbours.
  // When not encrypted, the chunk is written as-is.
  let offset = 0;
  let blobIndex = 0;

  try {
    while (offset < buffer.length) {
      // Ask for at least 1 byte of free space.  ensureCapacity returns the
      // active cluster when it has any usable room, and provisions a new one
      // only when the active cluster is full.  chunkSize below handles the
      // partial-fill: we write only what fits, then loop for the remainder.
      const cluster = await ensureCapacity(userId, 1);
      const free = USABLE_BYTES - cluster.storageUsedBytes;

      // When encrypting, reserve room for the encryption overhead so the
      // stored blob fits within the cluster's remaining capacity.
      const maxPlaintext = encrypt
        ? Math.max(1, free - ENCRYPTION_OVERHEAD)
        : free;
      const plaintextChunkSize = Math.min(maxPlaintext, buffer.length - offset);
      const plaintextChunk = buffer.subarray(offset, offset + plaintextChunkSize);

      // Optionally encrypt this chunk independently
      const storedChunk = encrypt ? encryptBuffer(plaintextChunk, encryptionKey!) : plaintextChunk;

      // Write chunk to GridFS on this cluster.
      // getOrOpenBucket opens the connection lazily if it was not rehydrated at boot.
      const bucket = await getOrOpenBucket(cluster.clusterId);
      if (!bucket) {
        throw new Error(`No GridFS bucket available for cluster ${cluster.clusterId}`);
      }

      const gridfsId = await writeToGridFS(bucket as MongooseGridFSBucket, storedChunk, `${fileDoc._id}_${blobIndex}`);

      // Record Blob
      await BlobModel.create({
        fileId: fileDoc._id,
        clusterId: cluster._id, // ObjectId of StorageCluster doc
        gridfsId,
        index: blobIndex,
        size: storedChunk.length,
        plaintextSize: plaintextChunkSize,
      });

      // Update cluster's storageUsedBytes
      await StorageClusterModel.findByIdAndUpdate(cluster._id, {
        $inc: { storageUsedBytes: storedChunk.length },
      });

      offset += plaintextChunkSize;
      blobIndex += 1;
    }
  } catch (err) {
    // Rollback: remove blobs and file doc
    const blobs = await BlobModel.find({ fileId: fileDoc._id });
    for (const blob of blobs) {
      try {
        const clusterDoc = await StorageClusterModel.findById(blob.clusterId);
        if (clusterDoc) {
          const bucket = await getOrOpenBucket(clusterDoc.clusterId);
          if (bucket) {
            await deleteFromGridFS(bucket as MongooseGridFSBucket, blob.gridfsId);
          }
          await StorageClusterModel.findByIdAndUpdate(blob.clusterId, {
            $inc: { storageUsedBytes: -blob.size },
          });
        }
      } catch {
        // best-effort
      }
    }
    await BlobModel.deleteMany({ fileId: fileDoc._id });
    await FileModel.findByIdAndDelete(fileDoc._id);
    throw err;
  }

  return FileModel.findById(fileDoc._id);
}

/**
 * Read a file's bytes from GridFS, reassembling blobs in order.
 * Decrypts if the file is marked encrypted (requires encryptionKey).
 */
export async function readFile(fileId: string, encryptionKey?: string): Promise<Buffer> {
  const fileDoc = await FileModel.findById(fileId);
  if (!fileDoc) {
    throw new Error(`File not found: ${fileId}`);
  }

  const blobs = await BlobModel.find({ fileId: new Types.ObjectId(fileId) }).sort({ index: 1 });
  if (blobs.length === 0) {
    throw new Error(`No blobs found for file: ${fileId}`);
  }

  const parts: Buffer[] = [];

  for (const blob of blobs) {
    const clusterDoc = await StorageClusterModel.findById(blob.clusterId);
    if (!clusterDoc) {
      throw new Error(`StorageCluster not found for blob ${blob._id}`);
    }
    const bucket = await getOrOpenBucket(clusterDoc.clusterId);
    if (!bucket) {
      throw new Error(`No GridFS bucket for cluster ${clusterDoc.clusterId}`);
    }
    const data = await readFromGridFS(bucket as MongooseGridFSBucket, blob.gridfsId);
    parts.push(data);
  }

  const combined = Buffer.concat(parts);

  if (fileDoc.encrypted) {
    if (!encryptionKey) {
      throw new Error('encryptionKey required to decrypt file');
    }
    return decryptBuffer(combined, encryptionKey);
  }

  return combined;
}

/**
 * Delete all GridFS objects and Blob records for a file.
 * Decrements each cluster's storageUsedBytes.
 * Does NOT delete the File doc (caller is responsible).
 */
export async function deleteFileBytes(fileId: string): Promise<void> {
  const blobs = await BlobModel.find({ fileId: new Types.ObjectId(fileId) });

  for (const blob of blobs) {
    try {
      const clusterDoc = await StorageClusterModel.findById(blob.clusterId);
      if (clusterDoc) {
        const bucket = await getOrOpenBucket(clusterDoc.clusterId);
        if (bucket) {
          await deleteFromGridFS(bucket as MongooseGridFSBucket, blob.gridfsId);
        }
        await StorageClusterModel.findByIdAndUpdate(blob.clusterId, {
          $inc: { storageUsedBytes: -blob.size },
        });
      }
    } catch {
      // best-effort: continue deleting remaining blobs
    }
  }

  await BlobModel.deleteMany({ fileId: new Types.ObjectId(fileId) });
}

// ---- GridFS helpers ---------------------------------------------------------

// Type alias to avoid importing from nested mongodb
type MongooseGridFSBucket = {
  openUploadStream(filename: string, options?: object): NodeJS.WritableStream & { id: Types.ObjectId };
  openDownloadStream(id: Types.ObjectId): Readable;
  delete(id: Types.ObjectId): Promise<void>;
};

function writeToGridFS(
  bucket: MongooseGridFSBucket,
  data: Buffer,
  filename: string,
): Promise<Types.ObjectId> {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename);
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => {
      resolve(uploadStream.id as Types.ObjectId);
    });
    uploadStream.end(data);
  });
}

function readFromGridFS(bucket: MongooseGridFSBucket, gridfsId: Types.ObjectId): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStream(gridfsId);
    const chunks: Buffer[] = [];
    downloadStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    downloadStream.on('error', reject);
    downloadStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function deleteFromGridFS(bucket: MongooseGridFSBucket, gridfsId: Types.ObjectId): Promise<void> {
  return bucket.delete(gridfsId);
}

// Re-export for use by other modules
export { ENCRYPTION_OVERHEAD };
