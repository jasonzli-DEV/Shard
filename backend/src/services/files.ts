/**
 * File tree service — Phase 5.1
 *
 * Manages File metadata: folders, listing, rename, move, star, soft-delete/restore/purge.
 * Maintains `path` and `(userId,path)` uniqueness.
 * On rename/move of a folder, recursively updates descendant paths.
 */
import { Types } from 'mongoose';
import { FileModel, type IFile } from '../models/File';
import { ShareModel } from '../models/Share';
import { PublicLinkModel } from '../models/PublicLink';
import { deleteFileBytes } from '../storage/storageService';
import { buildPath } from '../utils/paths';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure a path is unique for this user (within non-deleted files). */
async function assertPathUnique(userId: string, path: string, excludeId?: string): Promise<void> {
  const query: Record<string, unknown> = { userId: new Types.ObjectId(userId), path, deletedAt: null };
  if (excludeId) {
    query['_id'] = { $ne: new Types.ObjectId(excludeId) };
  }
  const existing = await FileModel.exists(query);
  if (existing) {
    throw Object.assign(new Error(`A file or folder named "${path}" already exists.`), {
      code: 'PATH_CONFLICT',
    });
  }
}

/** Recursively update paths of all descendants of a folder. */
async function updateDescendantPaths(
  userId: string,
  oldFolderPath: string,
  newFolderPath: string,
): Promise<void> {
  const descendants = await FileModel.find({
    userId: new Types.ObjectId(userId),
    path: new RegExp(`^${escapeRegex(oldFolderPath)}/`),
  });

  for (const desc of descendants) {
    const newPath = newFolderPath + desc.path.slice(oldFolderPath.length);
    await FileModel.updateOne({ _id: desc._id }, { path: newPath });
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a folder.
 * @param userId - owning user's string ObjectId
 * @param parentId - parent folder's string ObjectId, or null for root
 * @param name - folder name
 */
export async function createFolder(
  userId: string,
  parentId: string | null,
  name: string,
): Promise<IFile> {
  if (!name || !name.trim()) {
    throw Object.assign(new Error('Folder name is required'), { code: 'VALIDATION_ERROR' });
  }

  const trimmedName = name.trim();

  // Resolve parent path
  let parentPath: string | null = null;
  if (parentId) {
    const parent = await FileModel.findOne({
      _id: new Types.ObjectId(parentId),
      userId: new Types.ObjectId(userId),
      type: 'folder',
      deletedAt: null,
    });
    if (!parent) {
      throw Object.assign(new Error('Parent folder not found'), { code: 'NOT_FOUND' });
    }
    parentPath = parent.path;
  }

  const folderPath = buildPath(parentPath, trimmedName);
  await assertPathUnique(userId, folderPath);

  return FileModel.create({
    userId: new Types.ObjectId(userId),
    parentId: parentId ? new Types.ObjectId(parentId) : null,
    name: trimmedName,
    path: folderPath,
    mimeType: 'application/x-directory',
    size: 0,
    type: 'folder',
    encrypted: false,
  });
}

/**
 * List files in a directory (excludes soft-deleted items).
 * @param userId - owning user's string ObjectId
 * @param parentId - parent folder's string ObjectId, or null for root
 */
export async function list(userId: string, parentId: string | null): Promise<IFile[]> {
  const query: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    deletedAt: null,
    uploading: { $ne: true },
  };

  if (parentId) {
    if (!Types.ObjectId.isValid(parentId)) {
      throw Object.assign(new Error('Invalid parentId'), { code: 'VALIDATION_ERROR' });
    }
    query['parentId'] = new Types.ObjectId(parentId);
  } else {
    query['parentId'] = null;
  }

  return FileModel.find(query).sort({ type: -1, name: 1 });
}

/**
 * Rename a file or folder.
 * If it's a folder, recursively updates descendant paths.
 */
export async function rename(userId: string, fileId: string, newName: string): Promise<IFile> {
  if (!newName || !newName.trim()) {
    throw Object.assign(new Error('Name is required'), { code: 'VALIDATION_ERROR' });
  }

  const trimmedName = newName.trim();
  const file = await FileModel.findOne({
    _id: new Types.ObjectId(fileId),
    userId: new Types.ObjectId(userId),
    deletedAt: null,
  });

  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  // Build new path: same parent, different name
  const parentPath = file.path.includes('/')
    ? file.path.substring(0, file.path.lastIndexOf('/')) || null
    : null;

  // For root items, parentPath is empty string from substring — normalize
  const normalizedParentPath = parentPath === '' ? null : parentPath;
  const newPath = buildPath(normalizedParentPath, trimmedName);

  if (newPath !== file.path) {
    await assertPathUnique(userId, newPath, fileId);
  }

  const oldPath = file.path;
  file.name = trimmedName;
  file.path = newPath;
  await file.save();

  // Cascade path updates to descendants if this is a folder
  if (file.type === 'folder' && oldPath !== newPath) {
    await updateDescendantPaths(userId, oldPath, newPath);
  }

  return file;
}

/**
 * Move a file or folder to a new parent.
 * If it's a folder, recursively updates descendant paths.
 */
export async function move(
  userId: string,
  fileId: string,
  newParentId: string | null,
): Promise<IFile> {
  const file = await FileModel.findOne({
    _id: new Types.ObjectId(fileId),
    userId: new Types.ObjectId(userId),
    deletedAt: null,
  });

  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  // Resolve new parent path
  let newParentPath: string | null = null;
  if (newParentId) {
    if (!Types.ObjectId.isValid(newParentId)) {
      throw Object.assign(new Error('Invalid newParentId'), { code: 'VALIDATION_ERROR' });
    }
    const newParent = await FileModel.findOne({
      _id: new Types.ObjectId(newParentId),
      userId: new Types.ObjectId(userId),
      type: 'folder',
      deletedAt: null,
    });
    if (!newParent) {
      throw Object.assign(new Error('Target parent folder not found'), { code: 'NOT_FOUND' });
    }

    // Prevent moving a folder into itself or one of its descendants
    if (file.type === 'folder') {
      if (newParent.path === file.path || newParent.path.startsWith(file.path + '/')) {
        throw Object.assign(new Error('Cannot move a folder into itself or its descendant'), {
          code: 'INVALID_MOVE',
        });
      }
    }

    newParentPath = newParent.path;
  }

  const oldPath = file.path;
  const newPath = buildPath(newParentPath, file.name);

  if (newPath !== oldPath) {
    await assertPathUnique(userId, newPath, fileId);
  }

  file.parentId = newParentId ? new Types.ObjectId(newParentId) : null;
  file.path = newPath;
  await file.save();

  // Cascade path updates to descendants if this is a folder
  if (file.type === 'folder' && oldPath !== newPath) {
    await updateDescendantPaths(userId, oldPath, newPath);
  }

  return file;
}

/**
 * Set or unset the starred flag on a file/folder.
 */
export async function star(userId: string, fileId: string, starred: boolean): Promise<IFile> {
  const file = await FileModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(fileId),
      userId: new Types.ObjectId(userId),
      deletedAt: null,
    },
    { starred },
    { new: true },
  );

  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  return file;
}

/**
 * Soft-delete a file or folder (sets deletedAt).
 * Does NOT delete bytes — use purge() for that.
 */
export async function softDelete(userId: string, fileId: string): Promise<IFile> {
  const file = await FileModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(fileId),
      userId: new Types.ObjectId(userId),
      deletedAt: null,
    },
    { deletedAt: new Date() },
    { new: true },
  );

  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  return file;
}

/**
 * Restore a soft-deleted file/folder.
 */
export async function restore(userId: string, fileId: string): Promise<IFile> {
  const file = await FileModel.findOne({
    _id: new Types.ObjectId(fileId),
    userId: new Types.ObjectId(userId),
  });

  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  if (!file.deletedAt) {
    throw Object.assign(new Error('File is not deleted'), { code: 'NOT_DELETED' });
  }

  // Check if the path is still available (another file may have taken it after the delete)
  const conflict = await FileModel.findOne({
    userId: new Types.ObjectId(userId),
    path: file.path,
    deletedAt: null,
    _id: { $ne: file._id },
  });

  if (conflict) {
    throw Object.assign(
      new Error(`Cannot restore: path "${file.path}" is already occupied`),
      { code: 'PATH_CONFLICT' },
    );
  }

  file.deletedAt = null;
  await file.save();

  return file;
}

/**
 * Permanently delete a file or folder.
 * For files: also deletes bytes from GridFS via deleteFileBytes.
 * For folders: recursively purges all descendants.
 */
export async function purge(userId: string, fileId: string): Promise<void> {
  const file = await FileModel.findOne({
    _id: new Types.ObjectId(fileId),
    userId: new Types.ObjectId(userId),
  });

  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  if (file.type === 'folder') {
    // Recursively purge descendants (including nested folders)
    const descendants = await FileModel.find({
      userId: new Types.ObjectId(userId),
      path: new RegExp(`^${escapeRegex(file.path)}/`),
    });

    for (const desc of descendants) {
      if (desc.type === 'file') {
        await deleteFileBytes(desc._id.toString()).catch(() => null);
      }
      // Cascade-delete Share and PublicLink records for each descendant file (M2)
      await ShareModel.deleteMany({ fileId: desc._id }).catch(() => null);
      await PublicLinkModel.deleteMany({ fileId: desc._id }).catch(() => null);
      await FileModel.deleteOne({ _id: desc._id });
    }
  } else {
    // Delete bytes from GridFS
    await deleteFileBytes(fileId).catch(() => null);
  }

  // Cascade-delete Share and PublicLink records for this file/folder (M2)
  await ShareModel.deleteMany({ fileId: file._id }).catch(() => null);
  await PublicLinkModel.deleteMany({ fileId: file._id }).catch(() => null);

  await FileModel.deleteOne({ _id: file._id });
}

/**
 * List all soft-deleted items for the user (recycle bin).
 */
export async function listTrash(userId: string): Promise<IFile[]> {
  return FileModel.find({
    userId: new Types.ObjectId(userId),
    deletedAt: { $ne: null },
  }).sort({ deletedAt: -1 });
}

/**
 * Search files and folders by name (case-insensitive, non-deleted only).
 */
export async function search(userId: string, query: string): Promise<IFile[]> {
  if (!query || !query.trim()) {
    return [];
  }

  return FileModel.find({
    userId: new Types.ObjectId(userId),
    deletedAt: null,
    uploading: { $ne: true },
    name: { $regex: escapeRegex(query.trim()), $options: 'i' },
  }).sort({ name: 1 });
}
