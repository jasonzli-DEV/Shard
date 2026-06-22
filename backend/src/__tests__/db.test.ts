import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectStarter, getStarter, closeStarter } from '../lib/db';

describe('Starter DB connection', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await closeStarter();
    await mongod.stop();
  });

  it('connectStarter returns a mongoose Connection and getStarter returns the same instance', async () => {
    const uri = mongod.getUri();
    const conn = await connectStarter(uri);

    expect(conn).toBeDefined();
    expect(conn.readyState).toBe(1); // 1 = connected

    const same = getStarter();
    expect(same).toBe(conn);
  });

  it('getStarter throws if called before connectStarter', async () => {
    // We need a fresh module state — simulate the un-initialised case
    // by checking the exported throw guard. connectStarter was already called above,
    // so we test the error message text by re-implementing the guard logic here:
    const { closeStarter: close } = await import('../lib/db');
    await close(); // reset
    expect(() => getStarter()).toThrow('Starter connection not initialised');
  });

  it('connectStarter is idempotent (second call returns the same connection)', async () => {
    const uri = mongod.getUri();
    const conn1 = await connectStarter(uri);
    const conn2 = await connectStarter(uri);
    expect(conn1).toBe(conn2);
  });
});
