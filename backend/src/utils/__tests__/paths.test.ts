import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { FileModel } from '../../models/File';
import { getUniqueName } from '../paths';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await FileModel.deleteMany({});
});

const userId = new mongoose.Types.ObjectId();

async function seedFile(path: string) {
  await FileModel.create({
    userId,
    name: path.split('/').pop()!,
    path,
    mimeType: 'text/plain',
    size: 0,
    type: 'file',
  });
}

describe('getUniqueName', () => {
  it('returns original name when no collision exists', async () => {
    const name = await getUniqueName(userId.toString(), null, 'document.txt');
    expect(name).toBe('document.txt');
  });

  it('appends (1) when the name collides at root', async () => {
    await seedFile('/document.txt');
    const name = await getUniqueName(userId.toString(), null, 'document.txt');
    expect(name).toBe('document (1).txt');
  });

  it('increments counter until a unique name is found', async () => {
    await seedFile('/document.txt');
    await seedFile('/document (1).txt');
    await seedFile('/document (2).txt');
    const name = await getUniqueName(userId.toString(), null, 'document.txt');
    expect(name).toBe('document (3).txt');
  });

  it('dedupes within a subfolder path', async () => {
    await seedFile('/folder/report.pdf');
    const name = await getUniqueName(userId.toString(), '/folder', 'report.pdf');
    expect(name).toBe('report (1).pdf');
  });

  it('handles files without extension', async () => {
    await seedFile('/Makefile');
    const name = await getUniqueName(userId.toString(), null, 'Makefile');
    expect(name).toBe('Makefile (1)');
  });

  it('does not cross-pollute between users', async () => {
    const otherUser = new mongoose.Types.ObjectId();
    await FileModel.create({
      userId: otherUser,
      name: 'shared.txt',
      path: '/shared.txt',
      mimeType: 'text/plain',
      size: 0,
      type: 'file',
    });
    // userId has no file named shared.txt, so no dedupe needed
    const name = await getUniqueName(userId.toString(), null, 'shared.txt');
    expect(name).toBe('shared.txt');
  });
});
