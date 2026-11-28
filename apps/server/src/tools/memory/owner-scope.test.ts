import { describe, it, expect, vi } from 'vitest';
import { OWNER_MEMORY_AGENT_ID } from '@aidyagent/shared-types';
import type { MemoriesRepository, SessionsStore } from '@aidyagent/db';
import { createLogger } from '../../lib/logger';
import { createMemoryTools, type MemoryToolDeps } from './index.js';

function setup(customer: boolean, ownerFact = false) {
  const memoriesRepo = {
    search: vi.fn(async () => []),
    create: vi.fn(async (input: { agentId: string }) => ({
      id: 'new',
      ...input,
    })),
    findById: vi.fn(async (id: string) => ({
      id,
      agentId: ownerFact ? OWNER_MEMORY_AGENT_ID : 'agent-a',
    })),
    delete: vi.fn(async () => true),
  };
  const deps: MemoryToolDeps = {
    memoriesRepo: memoriesRepo as unknown as MemoriesRepository,
    sessionsRepo: {} as SessionsStore,
    defaultAgentId: 'default',
    createLogger,
    isCustomerSession: async () => customer,
  };
  const tools = new Map(createMemoryTools(deps).map((t) => [t.name, t]));
  const ctx = { agentId: 'agent-a', sessionId: 's1' };
  return { memoriesRepo, tools, ctx };
}

describe('memory tools and the owner scope', () => {
  it('memory_search leaves owner facts out of a customer chat', async () => {
    const { memoriesRepo, tools, ctx } = setup(true);
    await tools.get('memory_search')!.execute({ query: 'Ana' }, ctx);
    expect(memoriesRepo.search).toHaveBeenCalledWith(
      'Ana',
      'agent-a',
      10,
      false,
    );
  });

  it('memory_search includes owner facts when talking to the owner', async () => {
    const { memoriesRepo, tools, ctx } = setup(false);
    await tools.get('memory_search')!.execute({ query: 'Ana' }, ctx);
    expect(memoriesRepo.search).toHaveBeenCalledWith(
      'Ana',
      'agent-a',
      10,
      true,
    );
  });

  it('memory_save with scope owner saves to the shared owner memory', async () => {
    const { memoriesRepo, tools, ctx } = setup(false);
    const result = await tools
      .get('memory_save')!
      .execute({ title: 'T', content: 'C', scope: 'owner' }, ctx);
    expect(result.ok).toBe(true);
    expect(memoriesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: OWNER_MEMORY_AGENT_ID }),
    );
  });

  it('memory_save refuses scope owner in a customer chat', async () => {
    const { memoriesRepo, tools, ctx } = setup(true);
    const result = await tools
      .get('memory_save')!
      .execute({ title: 'T', content: 'C', scope: 'owner' }, ctx);
    expect(result.ok).toBe(false);
    expect(memoriesRepo.create).not.toHaveBeenCalled();
  });

  it('memory_delete forgets an owner fact for the owner, not for a customer', async () => {
    const owner = setup(false, true);
    await owner.tools.get('memory_delete')!.execute({ id: 'm1' }, owner.ctx);
    expect(owner.memoriesRepo.delete).toHaveBeenCalledWith(
      'm1',
      OWNER_MEMORY_AGENT_ID,
    );

    const customer = setup(true, true);
    const result = await customer.tools
      .get('memory_delete')!
      .execute({ id: 'm1' }, customer.ctx);
    expect(result.ok).toBe(false);
    expect(customer.memoriesRepo.delete).not.toHaveBeenCalled();
  });
});
