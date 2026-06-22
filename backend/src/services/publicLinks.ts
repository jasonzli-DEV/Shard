/**
 * Public links service — Phase 6.2
 *
 * Creates, lists, and resolves public links for files.
 * Default expiry: 7 days.
 */
import { Types } from 'mongoose';
import { FileModel, type IFile } from '../models/File';
import { PublicLinkModel, type IPublicLink } from '../models/PublicLink';
import { generateUniqueSlug } from '../utils/slug';

const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface CreatePublicLinkResult {
  _id: string;
  fileId: string;
  slug: string;
  url: string;
  expiresAt: Date;
  downloadCount: number;
  createdAt: Date;
}

/**
 * Create a public link for a file.
 * Only the file owner may create links.
 * @param callerId - The authenticated user's ID
 * @param fileId - The file to link
 * @param expiresIn - Optional expiry in seconds from now (default 7 days)
 */
export async function createPublicLink(
  callerId: string,
  fileId: string,
  expiresIn?: number,
): Promise<CreatePublicLinkResult> {
  if (!Types.ObjectId.isValid(fileId)) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  const file = await FileModel.findById(fileId);
  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  if (file.userId.toString() !== callerId) {
    throw Object.assign(new Error('Only the file owner can create public links'), {
      code: 'OWNER_ONLY',
    });
  }

  const slug = await generateUniqueSlug();
  const expirySeconds = typeof expiresIn === 'number' && expiresIn > 0
    ? expiresIn
    : DEFAULT_EXPIRY_SECONDS;

  const expiresAt = new Date(Date.now() + expirySeconds * 1000);

  const link = await PublicLinkModel.create({
    fileId: new Types.ObjectId(fileId),
    slug,
    createdBy: new Types.ObjectId(callerId),
    expiresAt,
    downloadCount: 0,
  });

  const publicUrl = buildUrl(slug);

  return {
    _id: link._id.toString(),
    fileId: link.fileId.toString(),
    slug: link.slug,
    url: publicUrl,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    createdAt: link.createdAt,
  };
}

/**
 * List all public links created by the given user.
 */
export async function listUserPublicLinks(userId: string): Promise<IPublicLink[]> {
  return PublicLinkModel.find({ createdBy: new Types.ObjectId(userId) }).sort({ createdAt: -1 });
}

/**
 * Delete a public link by ID.
 * Only the creator may delete.
 */
export async function deletePublicLink(callerId: string, linkId: string): Promise<void> {
  if (!Types.ObjectId.isValid(linkId)) {
    throw Object.assign(new Error('Public link not found'), { code: 'NOT_FOUND' });
  }

  const link = await PublicLinkModel.findById(linkId);
  if (!link) {
    throw Object.assign(new Error('Public link not found'), { code: 'NOT_FOUND' });
  }

  if (link.createdBy.toString() !== callerId) {
    throw Object.assign(new Error('Only the creator can delete this link'), {
      code: 'OWNER_ONLY',
    });
  }

  await PublicLinkModel.deleteOne({ _id: link._id });
}

/**
 * Resolve a slug to file metadata.
 * Returns null if slug not found.
 * Throws EXPIRED if the link is expired.
 */
export async function resolveSlug(slug: string): Promise<IFile> {
  const link = await PublicLinkModel.findOne({ slug });
  if (!link) {
    throw Object.assign(new Error('Public link not found'), { code: 'NOT_FOUND' });
  }

  if (link.expiresAt && link.expiresAt < new Date()) {
    throw Object.assign(new Error('Public link has expired'), { code: 'EXPIRED' });
  }

  const file = await FileModel.findById(link.fileId);
  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  if (file.deletedAt != null) {
    throw Object.assign(new Error('File has been deleted'), { code: 'NOT_FOUND' });
  }

  return file;
}

/**
 * Increment download count for a link (fire-and-forget friendly).
 */
export async function incrementDownloadCount(slug: string): Promise<void> {
  await PublicLinkModel.updateOne({ slug }, { $inc: { downloadCount: 1 } });
}

function buildUrl(slug: string): string {
  const base = process.env.PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:4000';
  return `${base}/api/public/${slug}`;
}
