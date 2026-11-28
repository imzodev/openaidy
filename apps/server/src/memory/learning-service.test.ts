import { describe, it, expect, vi } from 'vitest';
import type { MemoryLearningCandidate } from '@aidyagent/shared-types';
import { MemoryLearningService } from './learning-service.js';

const candidate: MemoryLearningCandidate = {
  sessionId: 's1',
  agentId: 'agent-a',
  throughSequence: -1,
  lastSequence: 2,
};

function setup(overrides: Record<string, unknown> = {}) {
  const deps = {
    memories: {
      listOwner: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      update: vi.fn(),
      delete: vi.fn(),
    },
    learningState: {
      findCandidates: vi.fn(async () => [candidate]),
      setCursor: vi.fn(async () => {}),
    },
    sessionMessages: {
      listBySession: vi.fn(async () => [
        {
          sequence: 1,
          role: 'user',
          content: 'I prefer mornings',
          metadata: null,
        },
        { sequence: 2, role: 'assistant', content: 'Noted', metadata: null },
      ]),
    },
    sessionRuns: {
      getLatest: vi.fn(async () => ({ providerId: 'p', modelId: 'm' })),
    },
    isEnabled: () => true,
    isCustomerSession: vi.fn(async () => false),
    complete: vi.fn(async () => ({
      ok: true as const,
      text: '{"ops":[{"op":"add","kind":"preference","title":"Mornings","content":"Prefers mornings"}]}',
    })),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ...overrides,
  };
  // The fakes implement only what the service calls.
  const service = new MemoryLearningService(
    deps as unknown as ConstructorParameters<typeof MemoryLearningService>[0],
  );
  return { deps, service };
}

describe('MemoryLearningService', () => {
  it('learns from an owner conversation with its own model and advances the cursor', async () => {
    const { deps, service } = setup();
    await service.sweep();
    expect(deps.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.stringContaining('I prefer mornings'),
      }),
      { providerId: 'p', modelId: 'm' },
    );
    expect(deps.memories.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'learned', sourceSessionId: 's1' }),
    );
    expect(deps.learningState.setCursor).toHaveBeenCalledWith('s1', 2);
  });

  it('does nothing when learning is off', async () => {
    const { deps, service } = setup({ isEnabled: () => false });
    await service.sweep();
    expect(deps.learningState.findCandidates).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('never reads a customer conversation, but moves past it', async () => {
    const { deps, service } = setup({
      isCustomerSession: vi.fn(async () => true),
    });
    await service.sweep();
    expect(deps.sessionMessages.listBySession).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.learningState.setCursor).toHaveBeenCalledWith('s1', 2);
  });

  it('skips turns the scheduler started without calling the model', async () => {
    const { deps, service } = setup({
      sessionMessages: {
        listBySession: vi.fn(async () => [
          {
            sequence: 1,
            role: 'user',
            content: 'Check Stripe',
            metadata: { origin: 'scheduler' },
          },
          { sequence: 2, role: 'assistant', content: 'None', metadata: null },
        ]),
      },
    });
    await service.sweep();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.learningState.setCursor).toHaveBeenCalledWith('s1', 2);
  });

  it('keeps the cursor when the model fails, and gives up after three tries', async () => {
    const { deps, service } = setup({
      complete: vi.fn(async () => ({ ok: false as const, error: 'down' })),
    });
    await service.sweep();
    await service.sweep();
    expect(deps.learningState.setCursor).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalled();
    await service.sweep();
    expect(deps.learningState.setCursor).toHaveBeenCalledWith('s1', 2);
    expect(deps.memories.create).not.toHaveBeenCalled();
  });
});
