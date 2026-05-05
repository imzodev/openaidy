import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initPresentChoicesTool,
  getPresentChoicesTool,
  resolvePendingChoice,
  rejectPendingChoice,
} from './present-choices';
import type { ChoicesEvent, PresentChoicesArgs } from '@openaidy/shared-types';
import type { BuiltinToolContext } from '@openaidy/runtime';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as import('fastify').FastifyBaseLogger;

let emittedEvents: ChoicesEvent[] = [];
const captureEmitter = (event: ChoicesEvent) => {
  emittedEvents.push(event);
};

// Mock context factory
const mockCtx = (
  overrides: Partial<BuiltinToolContext> = {},
): BuiltinToolContext =>
  ({
    agentId: 'test-agent',
    sessionId: 'test-session',
    runId: 'test-run',
    ...overrides,
  }) as unknown as BuiltinToolContext;

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  emittedEvents = [];
  initPresentChoicesTool(captureEmitter, fakeLogger);
});

// ─────────────────────────────────────────────────────────────────────────────
// present_choices tool — structure
// ─────────────────────────────────────────────────────────────────────────────

describe('present_choices tool', () => {
  it('should have name "present_choices"', () => {
    const tool = getPresentChoicesTool();
    expect(tool.name).toBe('present_choices');
  });

  it('should describe what it does in the description', () => {
    const tool = getPresentChoicesTool();
    expect(tool.description).toContain('choices');
    expect(tool.description).toContain('user');
  });

  it('should accept 2–6 choices in the parameters schema', () => {
    const tool = getPresentChoicesTool();
    const params = tool.parameters as {
      properties: { choices: { minItems: number; maxItems: number } };
      required: string[];
    };
    expect(params.properties.choices.minItems).toBe(2);
    expect(params.properties.choices.maxItems).toBe(6);
    expect(params.required).toContain('choices');
  });

  it('should NOT require question field', () => {
    const tool = getPresentChoicesTool();
    const params = tool.parameters as { required: string[] };
    expect(params.required).not.toContain('question');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool execute — validation
// ─────────────────────────────────────────────────────────────────────────────

describe('tool execute() — validation', () => {
  it('should reject if choices has fewer than 2 items', async () => {
    const tool = getPresentChoicesTool();
    const result = (await tool.execute!(
      { choices: ['only one'] } as unknown as PresentChoicesArgs,
      mockCtx(),
    )) as { ok: true; content: string } | { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/2.*6/);
  });

  it('should reject if choices has more than 6 items', async () => {
    const tool = getPresentChoicesTool();
    const result = (await tool.execute!(
      {
        choices: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      } as unknown as PresentChoicesArgs,
      mockCtx(),
    )) as { ok: true; content: string } | { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/2.*6/);
  });

  it('should reject if choices contains non-string values', async () => {
    const tool = getPresentChoicesTool();
    const result = (await tool.execute!(
      { choices: ['valid', 123 as unknown as string, 'also valid'] },
      mockCtx(),
    )) as { ok: true; content: string } | { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /non-empty strings/,
    );
  });

  it('should reject empty string choices', async () => {
    const tool = getPresentChoicesTool();
    const result = (await tool.execute!(
      { choices: ['valid', '', 'also valid'] } as unknown as PresentChoicesArgs,
      mockCtx(),
    )) as { ok: true; content: string } | { ok: false; error: string };
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/non-empty/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool execute — event emission
// ─────────────────────────────────────────────────────────────────────────────

describe('tool execute() — event emission', () => {
  it('should emit a ChoicesEvent with all required fields', async () => {
    const tool = getPresentChoicesTool();

    const runPromise = tool.execute!(
      {
        sessionId: 'sess-123',
        runId: 'run-456',
        question: 'Which would you prefer?',
        choices: ['Option A', 'Option B'],
      } as unknown as PresentChoicesArgs,
      mockCtx({ agentId: 'agent-abc' }),
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toMatchObject({
      sessionId: 'sess-123',
      runId: 'run-456',
      agentId: 'agent-abc',
      question: 'Which would you prefer?',
      choices: ['Option A', 'Option B'],
    });

    // Clean up
    resolvePendingChoice('sess-123', 'run-456', 'Option A', 0);
    await runPromise;
  });

  it('should use empty string when question is omitted', async () => {
    const tool = getPresentChoicesTool();

    const runPromise = tool.execute!(
      {
        sessionId: 'sess-1',
        runId: 'run-1',
        choices: ['Yes', 'No'],
      } as unknown as PresentChoicesArgs,
      mockCtx(),
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(emittedEvents[0].question).toBe('');

    resolvePendingChoice('sess-1', 'run-1', 'Yes', 0);
    await runPromise;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool execute() — pending choice resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('tool execute() — pending choice resolution', () => {
  it('should resolve with the selected label and index', async () => {
    const tool = getPresentChoicesTool();

    const runPromise = tool.execute!(
      {
        sessionId: 'sess-test',
        runId: 'run-test',
        choices: ['A', 'B', 'C'],
      } as unknown as PresentChoicesArgs,
      mockCtx(),
    );

    await new Promise((r) => setTimeout(r, 0));
    resolvePendingChoice('sess-test', 'run-test', 'C', 2);

    const result = await runPromise;
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed).toMatchObject({ selected: 'C', index: 2 });
  });

  it('should correctly track 0-based index', async () => {
    const tool = getPresentChoicesTool();

    const runPromise = tool.execute!(
      {
        sessionId: 'sess-idx',
        runId: 'run-idx',
        choices: ['First', 'Second', 'Third'],
      } as unknown as PresentChoicesArgs,
      mockCtx(),
    );

    await new Promise((r) => setTimeout(r, 0));
    resolvePendingChoice('sess-idx', 'run-idx', 'First', 0);

    const result = await runPromise;
    const parsed = JSON.parse(result.content);
    expect(parsed.index).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolvePendingChoice / rejectPendingChoice
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvePendingChoice', () => {
  it('should return false when no pending choice exists', () => {
    const result = resolvePendingChoice(
      'nonexistent-session',
      'nonexistent-run',
      'any',
      0,
    );
    expect(result).toBe(false);
  });

  it('should return true and resolve the waiting promise', async () => {
    const tool = getPresentChoicesTool();

    const runPromise = tool.execute!(
      {
        sessionId: 'sess-resolve',
        runId: 'run-resolve',
        choices: ['X', 'Y'],
      } as unknown as PresentChoicesArgs,
      mockCtx(),
    );

    await new Promise((r) => setTimeout(r, 0));
    const result = resolvePendingChoice('sess-resolve', 'run-resolve', 'Y', 1);
    expect(result).toBe(true);

    const resolved = await runPromise;
    const parsed = JSON.parse(resolved.content);
    expect(parsed.selected).toBe('Y');
  });
});

describe('rejectPendingChoice', () => {
  it('should return false when no pending choice exists', () => {
    const result = rejectPendingChoice(
      'nonexistent-session',
      'nonexistent-run',
      new Error('test'),
    );
    expect(result).toBe(false);
  });
});
