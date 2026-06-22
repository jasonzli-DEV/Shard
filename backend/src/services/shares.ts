/**
 * Shares service — Phase 6.1
 *
 * Manages file sharing between users.
 * canAccess() is the central access-control helper used by file routes.
 */
import { Types } from 'mongoose';
import { FileModel } from '../models/File';
import { ShareModel, type SharePermission } from '../models/Share';
import { UserModel } from '../models/User';

// ── canAccess ─────────────────────────────────────────────────────────────────

/**
 * Returns true if `userId` has access to `fileId` at the required permission level.
 *
 * Access is granted when:
 *   1. The user owns the file (always full access), OR
 *   2. A Share document grants the user >= `need` on the file directly, OR
 *   3. An ancestor folder of the file has a Share document granting the user >= `need`.
 *
 * Permission ordering: edit > view (edit implies view).
 */
export async function canAccess(
  userId: string,
  fileId: string,
  need: SharePermission,
): Promise<boolean> {
  // Validate ObjectId
  if (!Types.ObjectId.isValid(fileId) || !Types.ObjectId.isValid(userId)) {
    return false;
  }

  const file = await FileModel.findById(fileId);
  if (!file) return false;

  // Owner always has full access
  if (file.userId.toString() === userId) return true;

  // Check direct share on this file
  const directShare = await ShareModel.findOne({
    fileId: new Types.ObjectId(fileId),
    sharedWithId: new Types.ObjectId(userId),
  });

  if (directShare && permissionSatisfies(directShare.permission, need)) {
    return true;
  }

  // Check ancestor folder shares: find all shares on folders whose path is a prefix of this file's path
  // A folder share covers the folder and all its descendants.
  // Collect all path prefixes of the file (each ancestor folder path).
  const filePath = file.path;
  const ancestorPaths = getAncestorPaths(filePath);

  if (ancestorPaths.length > 0) {
    // Find ancestor folders owned by the file's owner
    const ancestorFolders = await FileModel.find({
      userId: file.userId,
      path: { $in: ancestorPaths },
      type: 'folder',
    }).select('_id');

    if (ancestorFolders.length > 0) {
      const folderIds = ancestorFolders.map((f) => f._id);
      const folderShare = await ShareModel.findOne({
        fileId: { $in: folderIds },
        sharedWithId: new Types.ObjectId(userId),
      });

      if (folderShare && permissionSatisfies(folderShare.permission, need)) {
        return true;
      }
    }
  }

  return false;
}

/** Returns true if `granted` permission satisfies `need`. edit satisfies view. */
function permissionSatisfies(granted: SharePermission, need: SharePermission): boolean {
  if (granted === need) return true;
  if (granted === 'edit' && need === 'view') return true;
  return false;
}

/** Returns all ancestor path segments of a file path (excluding the file itself). */
function getAncestorPaths(filePath: string): string[] {
  const parts = filePath.split('/');
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

// ── Share CRUD ────────────────────────────────────────────────────────────────

export interface ShareWithUser {
  _id: string;
  fileId: string;
  sharedWithId: string;
  permission: SharePermission;
  createdAt: Date;
  updatedAt: Date;
  sharedWith: {
    _id: string;
    email: string;
    displayName: string;
  };
}

export interface SharedWithMeItem {
  share: {
    _id: string;
    permission: SharePermission;
  };
  file: {
    _id: string;
    name: string;
    path: string;
    type: string;
    mimeType: string;
    size: number;
    createdAt: Date;
    updatedAt: Date;
  };
  owner: {
    _id: string;
    email: string;
    displayName: string;
  };
  permission: SharePermission;
}

/**
 * Share a file with a user.
 * Returns the upserted Share document.
 * Throws OWNER_ONLY if caller is not the file owner.
 * Throws SHARE_SELF if trying to share with self.
 * Throws NOT_FOUND if file or recipient not found.
 * Throws VALIDATION_ERROR for invalid inputs.
 */
export async function shareFile(
  callerId: string,
  fileId: string,
  recipientIdOrEmail: { userId?: string; email?: string },
  permission: SharePermission,
): Promise<{ share: InstanceType<typeof ShareModel>; isNew: boolean }> {
  // Validate permission
  if (permission !== 'view' && permission !== 'edit') {
    throw Object.assign(new Error('permission must be view or edit'), {
      code: 'VALIDATION_ERROR',
    });
  }

  // Resolve file
  if (!Types.ObjectId.isValid(fileId)) {
    throw Object.assign(new Error('Invalid fileId'), { code: 'NOT_FOUND' });
  }

  const file = await FileModel.findById(fileId);
  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  // Verify caller is owner
  if (file.userId.toString() !== callerId) {
    throw Object.assign(new Error('Only the file owner can share'), { code: 'OWNER_ONLY' });
  }

  // Resolve recipient
  let recipientId: string;

  if (recipientIdOrEmail.userId) {
    if (!Types.ObjectId.isValid(recipientIdOrEmail.userId)) {
      throw Object.assign(new Error('Invalid userId'), { code: 'VALIDATION_ERROR' });
    }
    const recipient = await UserModel.findById(recipientIdOrEmail.userId);
    if (!recipient) {
      throw Object.assign(new Error('Recipient user not found'), { code: 'NOT_FOUND' });
    }
    recipientId = recipient._id.toString();
  } else if (recipientIdOrEmail.email) {
    const recipient = await UserModel.findOne({ email: recipientIdOrEmail.email });
    if (!recipient) {
      throw Object.assign(new Error('Recipient user not found'), { code: 'NOT_FOUND' });
    }
    recipientId = recipient._id.toString();
  } else {
    throw Object.assign(new Error('Provide email or userId for recipient'), {
      code: 'VALIDATION_ERROR',
    });
  }

  // Cannot share with self
  if (recipientId === callerId) {
    throw Object.assign(new Error('Cannot share a file with yourself'), {
      code: 'SHARE_SELF',
    });
  }

  // Upsert: update if exists, create if not
  const existing = await ShareModel.findOne({
    fileId: new Types.ObjectId(fileId),
    sharedWithId: new Types.ObjectId(recipientId),
  });

  if (existing) {
    existing.permission = permission;
    await existing.save();
    return { share: existing, isNew: false };
  }

  const share = await ShareModel.create({
    fileId: new Types.ObjectId(fileId),
    sharedWithId: new Types.ObjectId(recipientId),
    permission,
  });

  return { share, isNew: true };
}

/**
 * Remove a share.
 * Only the file owner can unshare.
 */
export async function unshareFile(
  callerId: string,
  fileId: string,
  sharedWithId: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(fileId)) {
    throw Object.assign(new Error('Invalid fileId'), { code: 'NOT_FOUND' });
  }

  const file = await FileModel.findById(fileId);
  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  if (file.userId.toString() !== callerId) {
    throw Object.assign(new Error('Only the file owner can unshare'), { code: 'OWNER_ONLY' });
  }

  await ShareModel.deleteOne({
    fileId: new Types.ObjectId(fileId),
    sharedWithId: new Types.ObjectId(sharedWithId),
  });
}

/**
 * List all shares for a file (owner only).
 * Returns shares with populated sharedWith user info.
 */
export async function listFileShares(
  callerId: string,
  fileId: string,
): Promise<ShareWithUser[]> {
  if (!Types.ObjectId.isValid(fileId)) {
    throw Object.assign(new Error('Invalid fileId'), { code: 'NOT_FOUND' });
  }

  const file = await FileModel.findById(fileId);
  if (!file) {
    throw Object.assign(new Error('File not found'), { code: 'NOT_FOUND' });
  }

  if (file.userId.toString() !== callerId) {
    throw Object.assign(new Error('Only the file owner can view shares'), { code: 'OWNER_ONLY' });
  }

  const shares = await ShareModel.find({ fileId: new Types.ObjectId(fileId) }).sort({
    createdAt: 1,
  });

  const results: ShareWithUser[] = [];

  for (const share of shares) {
    const user = await UserModel.findById(share.sharedWithId).select('email displayName');
    if (user) {
      results.push({
        _id: share._id.toString(),
        fileId: share.fileId.toString(),
        sharedWithId: share.sharedWithId.toString(),
        permission: share.permission,
        createdAt: share.createdAt,
        updatedAt: share.updatedAt,
        sharedWith: {
          _id: user._id.toString(),
          email: user.email,
          displayName: user.displayName,
        },
      });
    }
  }

  return results;
}

/**
 * List all files shared with the current user.
 * Returns file info + owner info + permission.
 */
export async function listSharedWithMe(userId: string): Promise<SharedWithMeItem[]> {
  const shares = await ShareModel.find({
    sharedWithId: new Types.ObjectId(userId),
  }).sort({ createdAt: -1 });

  const results: SharedWithMeItem[] = [];

  for (const share of shares) {
    const file = await FileModel.findById(share.fileId).select(
      'name path type mimeType size createdAt updatedAt userId',
    );
    if (!file || file.deletedAt) continue;

    const owner = await UserModel.findById(file.userId).select('email displayName');
    if (!owner) continue;

    results.push({
      share: {
        _id: share._id.toString(),
        permission: share.permission,
      },
      file: {
        _id: file._id.toString(),
        name: file.name,
        path: file.path,
        type: file.type,
        mimeType: file.mimeType,
        size: file.size,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      },
      owner: {
        _id: owner._id.toString(),
        email: owner.email,
        displayName: owner.displayName,
      },
      permission: share.permission,
    });
  }

  return results;
}
