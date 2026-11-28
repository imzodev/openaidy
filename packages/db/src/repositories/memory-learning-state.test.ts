import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseClient } from '../client';
import { SessionsRepository } from './sessions';
import { SessionMessagesRepository } from './session-messages';
import { MemoryLearningStateRepository } from './memory-learning-state';

const HOUR = 60 * 60_000;
const window = () => ({
  idleBefore: new Date(Date.now() + HOUR).toISOString(),
  activeAfter: new Date(Date.now() - HOUR).toISOString(),
  limit: 10,
});

describe('MemoryLearningStateRepository', () => {
  let sessions: SessionsRepository;
  let messages: SessionMessagesRepository;
  let state: MemoryLearningStateRepository;

  beforeEach(async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: ':memory:',
    });
    sessions = new SessionsRepository(conn.db);
    messages = new SessionMessagesRepository(conn.db);
    state = new MemoryLearningStateRepository(conn.db);
  });

  it('round-trips a cursor and overwrites it', async () => {
    expect(await state.getCursor('s1')).toBeNull();
    await state.setCursor('s1', 4);
    await state.setCursor('s1', 9);
    expect(await state.getCursor('s1')).toMatchObject({
      sessionId: 's1',
      throughSequence: 9,
    });
  });

  it('finds chat sessions with messages past their cursor', async () => {
    const chat = await sessions.create({ title: 'chat' });
    await messages.append({ sessionId: chat.id, role: 'user', content: 'hi' });
    await messages.append({
      sessionId: chat.id,
      role: 'assistant',
      content: 'hello',
    });

    const [candidate] = await state.findCandidates(window());
    expect(candidate).toMatchObject({
      sessionId: chat.id,
      throughSequence: -1,
      lastSequence: 2,
    });

    await state.setCursor(chat.id, 2);
    expect(await state.findCandidates(window())).toEqual([]);

    await messages.append({
      sessionId: chat.id,
      role: 'user',
      content: 'more',
    });
    expect(await state.findCandidates(window())).toMatchObject([
      { sessionId: chat.id, throughSequence: 2, lastSequence: 3 },
    ]);
  });

  it('skips task sessions, sessions without user messages and busy ones', async () => {
    const task = await sessions.create({ title: 'task', type: 'task' });
    await messages.append({ sessionId: task.id, role: 'user', content: 'go' });
    const systemOnly = await sessions.create({ title: 'system' });
    await messages.append({
      sessionId: systemOnly.id,
      role: 'system',
      content: 'note',
    });
    expect(await state.findCandidates(window())).toEqual([]);

    const busy = await sessions.create({ title: 'busy' });
    await messages.append({ sessionId: busy.id, role: 'user', content: 'hi' });
    expect(
      await state.findCandidates({
        ...window(),
        idleBefore: new Date(Date.now() - HOUR).toISOString(),
      }),
    ).toEqual([]);
  });
});
