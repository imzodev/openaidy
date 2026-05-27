import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { SessionsRepository } from './sessions';
import { SessionMessagesRepository } from './session-messages';

type Database = DatabaseConnection['db'];

describe('SessionsRepository', () => {
  let db: Database;
  let sessionsRepo: SessionsRepository;
  let messagesRepo: SessionMessagesRepository;

  beforeEach(async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: ':memory:',
    });
    db = conn.db;
    sessionsRepo = new SessionsRepository(db);
    messagesRepo = new SessionMessagesRepository(db);
  });

  describe('searchByTitle', () => {
    it('returns sessions matching the title query with matchType title', async () => {
      const session = await sessionsRepo.create({
        title: 'React project setup',
      });

      const results = await sessionsRepo.searchByTitle('React');

      expect(results.length).toBeGreaterThan(0);
      const found = results.find((r) => r.id === session.id);
      expect(found).toBeDefined();
      expect(found!.matchType).toBe('title');
      expect(typeof found!.rank).toBe('number');
    });

    it('returns sessions ordered by BM25 rank (best match first)', async () => {
      await sessionsRepo.create({ title: 'React basics' });
      await sessionsRepo.create({ title: 'Advanced React patterns' });
      await sessionsRepo.create({ title: 'Vue introduction' });

      const results = await sessionsRepo.searchByTitle('React');

      expect(results.length).toBe(2);
      // The more relevant match should come first
      const [first, second] = results;
      expect(first?.title).toBe('React basics');
      expect(second?.title).toBe('Advanced React patterns');
    });

    it('returns empty array when no sessions match', async () => {
      await sessionsRepo.create({ title: 'React project' });

      const results = await sessionsRepo.searchByTitle('nonexistent_xyz_abc');

      expect(results).toEqual([]);
    });

    it('excludes specified session when excludeSessionId is provided', async () => {
      const sessionToExclude = await sessionsRepo.create({
        title: 'React project',
      });
      await sessionsRepo.create({ title: 'React tutorial' });

      const results = await sessionsRepo.searchByTitle(
        'React',
        5,
        sessionToExclude.id,
      );

      expect(results.every((r) => r.id !== sessionToExclude.id)).toBe(true);
    });

    it('respects the limit parameter', async () => {
      await sessionsRepo.create({ title: 'React project 1' });
      await sessionsRepo.create({ title: 'React project 2' });
      await sessionsRepo.create({ title: 'React project 3' });

      const results = await sessionsRepo.searchByTitle('React', 2);

      expect(results.length).toBe(2);
    });

    it('returns snippet as null (title search does not provide snippets)', async () => {
      await sessionsRepo.create({ title: 'React project' });

      const results = await sessionsRepo.searchByTitle('React');

      const [first] = results;
      expect(first?.snippet).toBeNull();
    });
  });

  describe('searchByContent', () => {
    it('returns sessions with messages matching the query', async () => {
      const session = await sessionsRepo.create({ title: 'My Session' });
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: 'How do I set up a React project?',
      });

      const results = await sessionsRepo.searchByContent('React');

      expect(results.length).toBeGreaterThan(0);
      const found = results.find((r) => r.id === session.id);
      expect(found).toBeDefined();
      expect(found!.matchType).toBe('content');
    });

    it('returns matchCount indicating how many messages matched', async () => {
      const session = await sessionsRepo.create({ title: 'My Session' });
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: 'React is a framework',
      });
      await messagesRepo.append({
        sessionId: session.id,
        role: 'assistant',
        content: 'Yes, React is popular',
      });
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: 'Tell me more about React',
      });

      const results = await sessionsRepo.searchByContent('React');
      const found = results.find((r) => r.id === session.id);

      expect(found!.matchCount).toBe(3);
    });

    it('returns a snippet of the matching content', async () => {
      const session = await sessionsRepo.create({ title: 'My Session' });
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: 'I love using React for building web applications',
      });

      const results = await sessionsRepo.searchByContent('React');
      const found = results.find((r) => r.id === session.id);

      expect(found!.snippet).not.toBeNull();
      expect(found!.snippet).toContain('React');
    });

    it('truncates long snippets to 200 characters', async () => {
      const session = await sessionsRepo.create({ title: 'My Session' });
      const longContent = 'A'.repeat(300);
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: longContent,
      });

      const results = await sessionsRepo.searchByContent('A');
      const found = results.find((r) => r.id === session.id);

      expect(found!.snippet!.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(found!.snippet).toContain('...');
    });

    it('returns empty array when no messages match', async () => {
      const session = await sessionsRepo.create({ title: 'My Session' });
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: 'Hello world',
      });

      const results = await sessionsRepo.searchByContent('nonexistent_xyz_abc');

      expect(results).toEqual([]);
    });

    it('excludes specified session when excludeSessionId is provided', async () => {
      const sessionToExclude = await sessionsRepo.create({
        title: 'Session to exclude',
      });
      await messagesRepo.append({
        sessionId: sessionToExclude.id,
        role: 'user',
        content: 'This mentions React',
      });

      const otherSession = await sessionsRepo.create({
        title: 'Other session',
      });
      await messagesRepo.append({
        sessionId: otherSession.id,
        role: 'user',
        content: 'This also mentions React',
      });

      const results = await sessionsRepo.searchByContent(
        'React',
        5,
        sessionToExclude.id,
      );

      expect(results.every((r) => r.id !== sessionToExclude.id)).toBe(true);
      expect(results.some((r) => r.id === otherSession.id)).toBe(true);
    });

    it('ranks sessions by match count then by relevance', async () => {
      const session1 = await sessionsRepo.create({ title: 'Session 1' });
      await messagesRepo.append({
        sessionId: session1.id,
        role: 'user',
        content: 'React is great',
      });

      const session2 = await sessionsRepo.create({ title: 'Session 2' });
      await messagesRepo.append({
        sessionId: session2.id,
        role: 'user',
        content: 'React is great',
      });
      await messagesRepo.append({
        sessionId: session2.id,
        role: 'assistant',
        content: 'Yes, React is popular',
      });
      await messagesRepo.append({
        sessionId: session2.id,
        role: 'user',
        content: 'Tell me more about React',
      });

      const results = await sessionsRepo.searchByContent('React');

      // Session with more matches should come first
      const [first, second] = results;
      expect(first?.id).toBe(session2.id);
      expect(first?.matchCount).toBe(3);
      expect(second?.id).toBe(session1.id);
      expect(second?.matchCount).toBe(1);
    });

    it('returns matchCount as undefined when no match count is available', async () => {
      // This test verifies the type allows matchCount to be optional
      // When searchByTitle is called, matchCount should not be present
      const session = await sessionsRepo.create({ title: 'React project' });

      const results = await sessionsRepo.searchByTitle('React');
      const found = results.find((r) => r.id === session.id);

      expect(found!.matchCount).toBeUndefined();
    });
  });

  describe('backfillMessagesFtsIndex', () => {
    it('indexes existing messages for content search', async () => {
      const session = await sessionsRepo.create({ title: 'Test Session' });
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: 'Initial message with React content',
      });

      // Index the existing messages
      await sessionsRepo.backfillMessagesFtsIndex();

      // Now search should find the message
      const results = await sessionsRepo.searchByContent('React');

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === session.id)).toBe(true);
    });
  });
});
