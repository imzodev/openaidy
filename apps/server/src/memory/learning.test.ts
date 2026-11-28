import { describe, it, expect, vi } from 'vitest';
import {
  COMPACTION_SUMMARY_KIND,
  OWNER_MEMORY_AGENT_ID,
  type Memory,
} from '@aidyagent/shared-types';
import type { MemoriesStore } from '@aidyagent/db';
import {
  MAX_OPS_PER_PASS,
  applyLearningOps,
  buildLearningRequest,
  parseLearningOps,
  selectLearnableMessages,
} from './learning.js';

const fact = (overrides: Partial<Memory> = {}): Memory => ({
  id: 'm1',
  agentId: OWNER_MEMORY_AGENT_ID,
  title: 'Short answers',
  content: 'Prefers short answers',
  tags: [],
  importance: 3,
  source: 'learned',
  kind: 'preference',
  sourceSessionId: 's0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const msg = (
  sequence: number,
  role: string,
  content: string,
  metadata?: Record<string, unknown>,
) => ({ sequence, role, content, metadata: metadata ?? null });

describe('selectLearnableMessages', () => {
  it('keeps only messages after the cursor', () => {
    const kept = selectLearnableMessages(
      [
        msg(1, 'user', 'old'),
        msg(2, 'assistant', 'old'),
        msg(3, 'user', 'new'),
      ],
      2,
    );
    expect(kept.map((m) => m.content)).toEqual(['new']);
  });

  it('drops turns started by the scheduler or another agent, with their replies', () => {
    const kept = selectLearnableMessages(
      [
        msg(1, 'user', 'Check Stripe', { origin: 'scheduler' }),
        msg(2, 'assistant', 'No new payments'),
        msg(3, 'user', 'I prefer mornings'),
        msg(4, 'assistant', 'Noted'),
        msg(5, 'user', 'Summarise this', { origin: 'agent' }),
        msg(6, 'tool', 'result'),
      ],
      -1,
    );
    expect(kept.map((m) => m.sequence)).toEqual([3, 4]);
  });

  it('drops compaction summaries', () => {
    const kept = selectLearnableMessages(
      [
        msg(1, 'system', 'summary', { kind: COMPACTION_SUMMARY_KIND }),
        msg(2, 'user', 'hi'),
      ],
      -1,
    );
    expect(kept.map((m) => m.sequence)).toEqual([2]);
  });
});

describe('buildLearningRequest', () => {
  it('lists known facts with ids so the model can update them', () => {
    const request = buildLearningRequest([fact()], '[user]: hi');
    expect(request).toContain('id=m1');
    expect(request).toContain('Prefers short answers');
    expect(request).toContain('[user]: hi');
  });

  it('says when nothing is known yet', () => {
    expect(buildLearningRequest([], 'x')).toContain('(nothing yet)');
  });
});

describe('parseLearningOps', () => {
  it('parses ops from JSON wrapped in a code fence', () => {
    const ops = parseLearningOps(
      '```json\n{"ops":[{"op":"add","kind":"person","title":"Ana","content":"Ana is the business partner","importance":4},{"op":"forget","id":"m1"}]}\n```',
    );
    expect(ops).toEqual([
      {
        op: 'add',
        kind: 'person',
        title: 'Ana',
        content: 'Ana is the business partner',
        importance: 4,
      },
      { op: 'forget', id: 'm1' },
    ]);
  });

  it('defaults importance and drops invalid ops one by one', () => {
    const ops = parseLearningOps(
      JSON.stringify({
        ops: [
          { op: 'add', kind: 'preference', title: 'T', content: 'C' },
          { op: 'add', kind: 'secret', title: 'T', content: 'C' },
          { op: 'update', id: 'm1' },
          { op: 'rewrite', id: 'm1' },
        ],
      }),
    );
    expect(ops).toEqual([
      {
        op: 'add',
        kind: 'preference',
        title: 'T',
        content: 'C',
        importance: 3,
      },
    ]);
  });

  it(`stops at ${MAX_OPS_PER_PASS} ops`, () => {
    const ops = parseLearningOps(
      JSON.stringify({
        ops: Array.from({ length: 9 }, (_, i) => ({
          op: 'forget',
          id: `m${i}`,
        })),
      }),
    );
    expect(ops).toHaveLength(MAX_OPS_PER_PASS);
  });

  it('returns an empty list for "nothing to learn" and null for non-JSON', () => {
    expect(parseLearningOps('{"ops":[]}')).toEqual([]);
    expect(parseLearningOps('Nothing new here.')).toBeNull();
    expect(parseLearningOps('{"result": "none"}')).toBeNull();
  });
});

describe('applyLearningOps', () => {
  const store = () =>
    ({
      create: vi.fn(async (input) => fact({ id: 'new', ...input })),
      update: vi.fn(async (id: string) => fact({ id })),
      delete: vi.fn(async () => true),
    }) as unknown as MemoriesStore & {
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };

  it('adds learned owner facts tagged with their session', async () => {
    const memories = store();
    const outcome = await applyLearningOps({
      ops: [
        {
          op: 'add',
          kind: 'routine',
          title: 'Books',
          content: 'Closes the books on Fridays',
          importance: 3,
        },
      ],
      known: [],
      memories,
      sessionId: 's1',
    });
    expect(outcome).toEqual({ added: 1, updated: 0, forgotten: 0 });
    expect(memories.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: OWNER_MEMORY_AGENT_ID,
        source: 'learned',
        kind: 'routine',
        sourceSessionId: 's1',
      }),
    );
  });

  it('only updates or forgets facts it was shown', async () => {
    const memories = store();
    const outcome = await applyLearningOps({
      ops: [
        { op: 'update', id: 'unknown', content: 'x' },
        { op: 'forget', id: 'unknown' },
        { op: 'update', id: 'm1', content: 'Prefers very short answers' },
      ],
      known: [fact()],
      memories,
      sessionId: 's1',
    });
    expect(outcome).toEqual({ added: 0, updated: 1, forgotten: 0 });
    expect(memories.update).toHaveBeenCalledTimes(1);
    expect(memories.update).toHaveBeenCalledWith(
      'm1',
      { content: 'Prefers very short answers' },
      OWNER_MEMORY_AGENT_ID,
    );
    expect(memories.delete).not.toHaveBeenCalled();
  });

  it('never forgets something the owner or an agent wrote on purpose', async () => {
    const memories = store();
    const outcome = await applyLearningOps({
      ops: [
        { op: 'forget', id: 'by-user' },
        { op: 'forget', id: 'learned' },
      ],
      known: [
        fact({ id: 'by-user', source: 'user' }),
        fact({ id: 'learned', source: 'learned' }),
      ],
      memories,
      sessionId: 's1',
    });
    expect(outcome.forgotten).toBe(1);
    expect(memories.delete).toHaveBeenCalledWith(
      'learned',
      OWNER_MEMORY_AGENT_ID,
    );
  });
});
