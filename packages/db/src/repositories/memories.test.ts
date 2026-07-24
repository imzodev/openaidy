import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabaseClient, type DatabaseConnection } from '../client';
import { MemoriesRepository, createMemoriesRepository } from './memories';

type Database = DatabaseConnection['db'];

describe('MemoriesRepository', () => {
  let db: Database;
  let repo: MemoriesRepository;

  beforeEach(async () => {
    const conn = await createDatabaseClient({
      kind: 'sqlite',
      sqlitePath: ':memory:',
    });
    db = conn.db;
    repo = createMemoriesRepository(db);
  });

  describe('create', () => {
    it('inserts a memory and returns a Memory with all fields populated', async () => {
      const memory = await repo.create({
        agentId: 'agent-a',
        title: 'Test Memory',
        content: 'Test content here',
        tags: ['test', 'unit'],
        importance: 4,
      });

      expect(memory.id).toBeTruthy();
      expect(typeof memory.id).toBe('string');
      expect(memory.agentId).toBe('agent-a');
      expect(memory.title).toBe('Test Memory');
      expect(memory.content).toBe('Test content here');
      expect(memory.tags).toEqual(['test', 'unit']);
      expect(memory.importance).toBe(4);
      expect(memory.createdAt).toBeTruthy();
      expect(memory.updatedAt).toBeTruthy();
    });

    it('tags defaults to [] when omitted', async () => {
      const memory = await repo.create({
        agentId: 'agent-a',
        title: 'No Tags',
        content: 'Content',
      });
      expect(memory.tags).toEqual([]);
    });

    it('importance defaults to 3 when omitted', async () => {
      const memory = await repo.create({
        agentId: 'agent-a',
        title: 'Default Importance',
        content: 'Content',
      });
      expect(memory.importance).toBe(3);
    });
  });

  describe('search', () => {
    it('match — after saving a memory with title "React project", search("React") returns it with a rank', async () => {
      await repo.create({
        agentId: 'agent-a',
        title: 'React project notes',
        content: 'Using React with TypeScript',
        importance: 5,
      });

      const results = await repo.search('React');
      expect(results.length).toBeGreaterThan(0);
      const first = results.find((r) => r.title === 'React project notes');
      expect(first).toBeDefined();
      expect(typeof first!.rank).toBe('number');
    });

    it('no match — search("nonexistent") returns []', async () => {
      await repo.create({
        agentId: 'agent-a',
        title: 'Real memory',
        content: 'Real content',
      });
      const results = await repo.search('nonexistent_xyz_abc');
      expect(results).toEqual([]);
    });

    it('agent scoping — two memories from different agents; search("test", "agent-a") returns only agent-a memory', async () => {
      await repo.create({
        agentId: 'agent-a',
        title: 'test memory A',
        content: 'content',
      });
      await repo.create({
        agentId: 'agent-b',
        title: 'test memory B',
        content: 'content',
      });

      const results = await repo.search('test', 'agent-a');
      expect(results.every((r) => r.agentId === 'agent-a')).toBe(true);
    });

    it('default agent (no scope) — search("test", undefined) returns memories from all agents', async () => {
      await repo.create({
        agentId: 'agent-a',
        title: 'test memory A',
        content: 'content',
      });
      await repo.create({
        agentId: 'agent-b',
        title: 'test memory B',
        content: 'content',
      });

      const results = await repo.search('test', undefined);
      expect(results.length).toBe(2);
    });
  });

  describe('list', () => {
    it('with agentId — returns only that agent memories, ordered by importance DESC', async () => {
      await repo.create({
        agentId: 'agent-a',
        title: 'Low',
        content: 'c',
        importance: 1,
      });
      await repo.create({
        agentId: 'agent-a',
        title: 'High',
        content: 'c',
        importance: 5,
      });
      await repo.create({
        agentId: 'agent-b',
        title: 'Other',
        content: 'c',
        importance: 5,
      });

      const results = await repo.list('agent-a');
      expect(results.length).toBe(2);
      expect(results[0]!.importance).toBeGreaterThanOrEqual(
        results[1]!.importance,
      );
      expect(results.every((r) => r.agentId === 'agent-a')).toBe(true);
    });

    it('without agentId — returns all memories', async () => {
      await repo.create({ agentId: 'agent-a', title: 'A', content: 'c' });
      await repo.create({ agentId: 'agent-b', title: 'B', content: 'c' });

      const results = await repo.list(undefined);
      expect(results.length).toBe(2);
    });
  });

  describe('update', () => {
    it('changes only provided fields and refreshes updatedAt', async () => {
      const created = await repo.create({
        agentId: 'agent-a',
        title: 'Original',
        content: 'Original content',
        tags: ['one'],
        importance: 2,
      });

      const updated = await repo.update(created.id, {
        title: 'Renamed',
        importance: 5,
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Renamed');
      expect(updated!.importance).toBe(5);
      // Untouched fields survive.
      expect(updated!.content).toBe('Original content');
      expect(updated!.tags).toEqual(['one']);
      expect(updated!.createdAt).toBe(created.createdAt);
    });

    it('replaces tags when provided', async () => {
      const created = await repo.create({
        agentId: 'agent-a',
        title: 'Tagged',
        content: 'c',
        tags: ['a', 'b'],
      });
      const updated = await repo.update(created.id, { tags: ['c'] });
      expect(updated!.tags).toEqual(['c']);
    });

    it('returns null when the memory does not exist', async () => {
      const updated = await repo.update('missing-id', { title: 'x' });
      expect(updated).toBeNull();
    });

    it('agent scoping — wrong agent updates nothing and returns null', async () => {
      const created = await repo.create({
        agentId: 'agent-a',
        title: 'Owned',
        content: 'c',
      });
      const updated = await repo.update(
        created.id,
        { title: 'Hacked' },
        'agent-b',
      );
      expect(updated).toBeNull();
      // Original is untouched.
      const list = await repo.list('agent-a');
      expect(list[0]!.title).toBe('Owned');
    });

    it('keeps FTS in sync — updated title is searchable', async () => {
      const created = await repo.create({
        agentId: 'agent-a',
        title: 'Alpha topic',
        content: 'body',
      });
      await repo.update(created.id, { title: 'Bravo topic' });

      const hitsOld = await repo.search('Alpha');
      expect(hitsOld.length).toBe(0);
      const hitsNew = await repo.search('Bravo');
      expect(hitsNew.some((r) => r.id === created.id)).toBe(true);
    });
  });

  describe('countByAgent', () => {
    it('returns per-agent counts; absent agents are omitted', async () => {
      await repo.create({ agentId: 'agent-a', title: 'A1', content: 'c' });
      await repo.create({ agentId: 'agent-a', title: 'A2', content: 'c' });
      await repo.create({ agentId: 'agent-b', title: 'B1', content: 'c' });

      const counts = await repo.countByAgent();
      expect(counts['agent-a']).toBe(2);
      expect(counts['agent-b']).toBe(1);
      expect(counts['agent-c']).toBeUndefined();
    });

    it('returns an empty map when there are no memories', async () => {
      const counts = await repo.countByAgent();
      expect(counts).toEqual({});
    });
  });

  describe('delete', () => {
    it('own memory — deletes and returns true', async () => {
      const memory = await repo.create({
        agentId: 'agent-a',
        title: 'To Delete',
        content: 'content',
      });
      const deleted = await repo.delete(memory.id, 'agent-a');
      expect(deleted).toBe(true);
    });

    it('wrong agent — returns false', async () => {
      const memory = await repo.create({
        agentId: 'agent-a',
        title: 'Not Yours',
        content: 'content',
      });
      const deleted = await repo.delete(memory.id, 'agent-b');
      expect(deleted).toBe(false);
    });

    it('no scope (undefined agentId) — deletes regardless of owner', async () => {
      const memory = await repo.create({
        agentId: 'agent-a',
        title: 'Delete Me',
        content: 'content',
      });
      const deleted = await repo.delete(memory.id, undefined);
      expect(deleted).toBe(true);
    });
  });
});
