/**
 * Task 5.1 — File tree service tests
 * Tests: createFolder, list, rename (cascades paths), move, soft-delete/restore, search
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Must set env before any import that might reference process.env
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';
process.env.FRONTEND_URL = 'http://localhost:5173';

let mongod: MongoMemoryServer;
let conn: mongoose.Connection;

// Mock deleteFileBytes so purge doesn't need real GridFS
jest.mock('../../storage/storageService', () => ({
  deleteFileBytes: jest.fn().mockResolvedValue(undefined),
  storeFile: jest.fn(),
  readFile: jest.fn(),
}));

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  conn = await mongoose.createConnection(mongod.getUri()).asPromise();

  // Register models on this test connection
  const { FileModel } = require('../../models/File');
  try { conn.model(FileModel.modelName); } catch {
    conn.model(FileModel.modelName, FileModel.schema);
  }
  // Point FileModel queries to our in-memory connection by replacing mongoose default
  // Since models use mongoose.model() we need to use the global mongoose connection
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await conn.close();
  await mongod.stop();
});

afterEach(async () => {
  // Clear files between tests
  const { FileModel } = require('../../models/File');
  await FileModel.deleteMany({});
});

import {
  createFolder,
  list,
  rename,
  move,
  star,
  softDelete,
  restore,
  purge,
  listTrash,
  search,
} from '../files';
import { FileModel } from '../../models/File';

const userId = new Types.ObjectId().toString();
const userId2 = new Types.ObjectId().toString();

describe('createFolder', () => {
  it('creates a root folder', async () => {
    const folder = await createFolder(userId, null, 'Documents');
    expect(folder.name).toBe('Documents');
    expect(folder.path).toBe('/Documents');
    expect(folder.type).toBe('folder');
    expect(folder.userId.toString()).toBe(userId);
    expect(folder.parentId).toBeNull();
  });

  it('creates a nested folder', async () => {
    const parent = await createFolder(userId, null, 'Parent');
    const child = await createFolder(userId, parent._id.toString(), 'Child');
    expect(child.path).toBe('/Parent/Child');
    expect(child.parentId?.toString()).toBe(parent._id.toString());
  });

  it('rejects duplicate name in same parent', async () => {
    await createFolder(userId, null, 'Docs');
    await expect(createFolder(userId, null, 'Docs')).rejects.toMatchObject({
      code: 'PATH_CONFLICT',
    });
  });

  it('allows same name in different parents', async () => {
    const a = await createFolder(userId, null, 'A');
    const b = await createFolder(userId, null, 'B');
    const childA = await createFolder(userId, a._id.toString(), 'shared');
    const childB = await createFolder(userId, b._id.toString(), 'shared');
    expect(childA.path).toBe('/A/shared');
    expect(childB.path).toBe('/B/shared');
  });

  it('rejects empty name', async () => {
    await expect(createFolder(userId, null, '  ')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects non-existent parent', async () => {
    const fakeId = new Types.ObjectId().toString();
    await expect(createFolder(userId, fakeId, 'Orphan')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('list', () => {
  it('lists root items for user', async () => {
    await createFolder(userId, null, 'Alpha');
    await createFolder(userId, null, 'Beta');
    const items = await list(userId, null);
    expect(items.length).toBe(2);
  });

  it('excludes soft-deleted items', async () => {
    const folder = await createFolder(userId, null, 'ToDelete');
    await softDelete(userId, folder._id.toString());
    const items = await list(userId, null);
    expect(items.find((f) => f._id.equals(folder._id))).toBeUndefined();
  });

  it('lists only items in specified parent', async () => {
    const parent = await createFolder(userId, null, 'Parent');
    await createFolder(userId, parent._id.toString(), 'Child1');
    await createFolder(userId, parent._id.toString(), 'Child2');
    await createFolder(userId, null, 'Sibling');

    const parentItems = await list(userId, parent._id.toString());
    expect(parentItems.length).toBe(2);
    expect(parentItems.every((f) => f.parentId?.toString() === parent._id.toString())).toBe(true);
  });

  it('does not return items from another user', async () => {
    await createFolder(userId, null, 'Mine');
    await createFolder(userId2, null, 'Theirs');
    const items = await list(userId, null);
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('Mine');
  });
});

describe('rename', () => {
  it('renames a file', async () => {
    const folder = await createFolder(userId, null, 'Old');
    // Insert a file directly
    const file = await FileModel.create({
      userId: new Types.ObjectId(userId),
      parentId: folder._id,
      name: 'file.txt',
      path: '/Old/file.txt',
      mimeType: 'text/plain',
      size: 100,
      type: 'file',
    });

    const updated = await rename(userId, file._id.toString(), 'newname.txt');
    expect(updated.name).toBe('newname.txt');
    expect(updated.path).toBe('/Old/newname.txt');
  });

  it('renames a folder and cascades child paths', async () => {
    const parent = await createFolder(userId, null, 'OldParent');
    const child = await createFolder(userId, parent._id.toString(), 'Child');
    const grandchild = await createFolder(userId, child._id.toString(), 'GrandChild');

    await rename(userId, parent._id.toString(), 'NewParent');

    const updatedChild = await FileModel.findById(child._id);
    const updatedGrandchild = await FileModel.findById(grandchild._id);

    expect(updatedChild?.path).toBe('/NewParent/Child');
    expect(updatedGrandchild?.path).toBe('/NewParent/Child/GrandChild');
  });

  it('rejects name conflict', async () => {
    await createFolder(userId, null, 'Alpha');
    const beta = await createFolder(userId, null, 'Beta');
    await expect(rename(userId, beta._id.toString(), 'Alpha')).rejects.toMatchObject({
      code: 'PATH_CONFLICT',
    });
  });

  it('rejects if file not found', async () => {
    const fakeId = new Types.ObjectId().toString();
    await expect(rename(userId, fakeId, 'NewName')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects empty name', async () => {
    const folder = await createFolder(userId, null, 'TestFolder');
    await expect(rename(userId, folder._id.toString(), '')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('move', () => {
  it('moves a folder to a new parent', async () => {
    const src = await createFolder(userId, null, 'Source');
    const dest = await createFolder(userId, null, 'Dest');
    const child = await createFolder(userId, src._id.toString(), 'Child');

    await move(userId, child._id.toString(), dest._id.toString());

    const updated = await FileModel.findById(child._id);
    expect(updated?.path).toBe('/Dest/Child');
    expect(updated?.parentId?.toString()).toBe(dest._id.toString());
  });

  it('moves a folder with descendants to root', async () => {
    const parent = await createFolder(userId, null, 'Parent');
    const child = await createFolder(userId, parent._id.toString(), 'Child');
    const grandchild = await createFolder(userId, child._id.toString(), 'Grand');

    await move(userId, child._id.toString(), null);

    const updatedChild = await FileModel.findById(child._id);
    const updatedGrandchild = await FileModel.findById(grandchild._id);
    expect(updatedChild?.path).toBe('/Child');
    expect(updatedGrandchild?.path).toBe('/Child/Grand');
  });

  it('rejects move into own descendant', async () => {
    const parent = await createFolder(userId, null, 'Parent');
    const child = await createFolder(userId, parent._id.toString(), 'Child');
    await expect(move(userId, parent._id.toString(), child._id.toString())).rejects.toMatchObject({
      code: 'INVALID_MOVE',
    });
  });

  it('rejects move into self', async () => {
    const folder = await createFolder(userId, null, 'Self');
    await expect(move(userId, folder._id.toString(), folder._id.toString())).rejects.toMatchObject({
      code: 'INVALID_MOVE',
    });
  });
});

describe('star', () => {
  it('stars a file', async () => {
    const folder = await createFolder(userId, null, 'MyFolder');
    const starred = await star(userId, folder._id.toString(), true);
    expect(starred.starred).toBe(true);
  });

  it('unstars a file', async () => {
    const folder = await createFolder(userId, null, 'Starred');
    await star(userId, folder._id.toString(), true);
    const unstarred = await star(userId, folder._id.toString(), false);
    expect(unstarred.starred).toBe(false);
  });
});

describe('softDelete / restore', () => {
  it('soft-deletes a file (sets deletedAt)', async () => {
    const folder = await createFolder(userId, null, 'ToSoftDelete');
    const deleted = await softDelete(userId, folder._id.toString());
    expect(deleted.deletedAt).toBeTruthy();
  });

  it('restores a soft-deleted file', async () => {
    const folder = await createFolder(userId, null, 'ToRestore');
    await softDelete(userId, folder._id.toString());
    const restored = await restore(userId, folder._id.toString());
    expect(restored.deletedAt).toBeNull();
  });

  it('cannot delete already-deleted file', async () => {
    const folder = await createFolder(userId, null, 'AlreadyDeleted');
    await softDelete(userId, folder._id.toString());
    await expect(softDelete(userId, folder._id.toString())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('cannot restore non-deleted file', async () => {
    const folder = await createFolder(userId, null, 'NotDeleted');
    await expect(restore(userId, folder._id.toString())).rejects.toMatchObject({
      code: 'NOT_DELETED',
    });
  });

  it('listTrash returns deleted items', async () => {
    const f1 = await createFolder(userId, null, 'Trash1');
    const f2 = await createFolder(userId, null, 'Trash2');
    await createFolder(userId, null, 'Active');

    await softDelete(userId, f1._id.toString());
    await softDelete(userId, f2._id.toString());

    const trash = await listTrash(userId);
    expect(trash.length).toBe(2);
    expect(trash.every((f) => f.deletedAt != null)).toBe(true);
  });
});

describe('purge', () => {
  it('purges a file and calls deleteFileBytes', async () => {
    const { deleteFileBytes } = require('../../storage/storageService');
    const file = await FileModel.create({
      userId: new Types.ObjectId(userId),
      name: 'purge.txt',
      path: '/purge.txt',
      mimeType: 'text/plain',
      size: 50,
      type: 'file',
    });

    await purge(userId, file._id.toString());
    expect(deleteFileBytes).toHaveBeenCalledWith(file._id.toString());

    const found = await FileModel.findById(file._id);
    expect(found).toBeNull();
  });

  it('purges a folder and all descendants', async () => {
    const parent = await createFolder(userId, null, 'PurgeParent');
    const child = await createFolder(userId, parent._id.toString(), 'PurgeChild');
    const grandchild = await createFolder(userId, child._id.toString(), 'PurgeGrand');

    await purge(userId, parent._id.toString());

    const all = await FileModel.find({ userId: new Types.ObjectId(userId) });
    expect(all.length).toBe(0);
    // grandchild is a folder so deleteFileBytes not called for it — no assertion needed
  });
});

describe('search', () => {
  it('finds files by name (case-insensitive)', async () => {
    await createFolder(userId, null, 'Documents');
    await createFolder(userId, null, 'Photos');
    await createFolder(userId, null, 'doc-archive');

    const results = await search(userId, 'doc');
    expect(results.length).toBe(2);
    const names = results.map((f) => f.name);
    expect(names).toContain('Documents');
    expect(names).toContain('doc-archive');
  });

  it('excludes soft-deleted items from search', async () => {
    const f = await createFolder(userId, null, 'SearchTarget');
    await softDelete(userId, f._id.toString());

    const results = await search(userId, 'SearchTarget');
    expect(results.length).toBe(0);
  });

  it('returns empty array for empty query', async () => {
    await createFolder(userId, null, 'SomeFile');
    const results = await search(userId, '');
    expect(results.length).toBe(0);
  });

  it('does not return another user\'s files', async () => {
    await createFolder(userId2, null, 'CrossUserFile');
    const results = await search(userId, 'CrossUserFile');
    expect(results.length).toBe(0);
  });
});
