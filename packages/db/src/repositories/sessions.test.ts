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
      // Repeat a real word so the content is both >200 chars and matchable
      // by the FTS query (a single 300-char token would not match 'React').
      const longContent = 'React is a great library for building UIs. '.repeat(
        10,
      );
      await messagesRepo.append({
        sessionId: session.id,
        role: 'user',
        content: longContent,
      });

      const results = await sessionsRepo.searchByContent('React');
      const found = results.find((r) => r.id === session.id);

      expect((found!.snippet as string).length).toBeLessThanOrEqual(203);
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

  describe('updateFavorite', () => {
    it('sets favoritedAt when favoriting and clears it when unfavoriting', async () => {
      const session = await sessionsRepo.create({ title: 'Pin me' });
      expect(session.favoritedAt).toBeFalsy();

      const favorited = await sessionsRepo.updateFavorite(session.id, true);
      expect(favorited?.favoritedAt).toBeTruthy();

      const unfavorited = await sessionsRepo.updateFavorite(session.id, false);
      expect(unfavorited?.favoritedAt).toBeFalsy();
    });

    it('does not bump updatedAt (favoriting is not activity)', async () => {
      const session = await sessionsRepo.create({ title: 'Keep recency' });
      const before = new Date(session.updatedAt).getTime();

      const favorited = await sessionsRepo.updateFavorite(session.id, true);
      const after = new Date(favorited!.updatedAt).getTime();

      expect(after).toBe(before);
    });

    it('returns null for a non-existent session', async () => {
      const result = await sessionsRepo.updateFavorite('nope', true);
      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('sets archivedAt on archive and clears it on unarchive', async () => {
      const session = await sessionsRepo.create({ title: 'Archive lifecycle' });

      const archived = await sessionsRepo.updateStatus(session.id, 'archived');
      expect(archived?.status).toBe('archived');
      expect(archived?.archivedAt).toBeTruthy();

      const restored = await sessionsRepo.updateStatus(session.id, 'active');
      expect(restored?.status).toBe('active');
      expect(restored?.archivedAt).toBeFalsy();
    });

    it('filters by status in list()', async () => {
      const active = await sessionsRepo.create({ title: 'Active one' });
      const toArchive = await sessionsRepo.create({ title: 'Archived one' });
      await sessionsRepo.updateStatus(toArchive.id, 'archived');

      const activeList = await sessionsRepo.list('active');
      expect(activeList.some((s) => s.id === active.id)).toBe(true);
      expect(activeList.some((s) => s.id === toArchive.id)).toBe(false);

      const archivedList = await sessionsRepo.list('archived');
      expect(archivedList.some((s) => s.id === toArchive.id)).toBe(true);
    });
  });
});
