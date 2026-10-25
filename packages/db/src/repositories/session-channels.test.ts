import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseAdapter, type DatabaseAdapter } from '../adapter';

describe('SessionChannelsRepository (sqlite)', () => {
  const dbPath = join(tmpdir(), `openaidy-session-channels-${Date.now()}.db`);
  let db: DatabaseAdapter;

  afterEach(async () => {
    if (db) await db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  it('records a route and replaces it on the next message', async () => {
    db = await createDatabaseAdapter({ kind: 'sqlite', sqlitePath: dbPath });
    const session = await db.repositories.sessions.create({ title: 'wa:x:1' });
    const routes = db.repositories.sessionChannels;
    expect(await routes.find(session.id)).toBeNull();

    await routes.record({
      sessionId: session.id,
      channelId: 'wa',
      channelType: 'whatsapp',
      target: '521@s.whatsapp.net',
      senderId: '521',
    });
    await routes.record({
      sessionId: session.id,
      channelId: 'wa',
      channelType: 'whatsapp',
      target: '521-group@g.us',
      senderId: '521',
    });
    const route = await routes.find(session.id);
    expect(route).toMatchObject({
      channelId: 'wa',
      target: '521-group@g.us',
      senderId: '521',
    });
  });
});
