import { describe, it, expect } from 'vitest';
import { OWNER_MEMORY_AGENT_ID, type Memory } from '@aidyagent/shared-types';
import {
  OWNER_MEMORY_BLOCK_MAX_CHARS,
  buildOwnerMemoryBlock,
  buildSystemPrompt,
  ownerMemoriesAllowed,
} from './build-system-prompt';

const fact = (title: string, content: string): Memory => ({
  id: title,
  agentId: OWNER_MEMORY_AGENT_ID,
  title,
  content,
  tags: [],
  importance: 3,
  source: 'learned',
  kind: 'preference',
  sourceSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('[ABOUT_THE_OWNER]', () => {
  it('lists what is known about the owner in the given order', () => {
    const block = buildOwnerMemoryBlock([
      fact('Short answers', 'Prefers short answers'),
      fact('Partner', 'Ana is the\nbusiness partner'),
    ]);
    expect(block).toContain('[ABOUT_THE_OWNER]');
    expect(block).toContain(
      '- Short answers: Prefers short answers\n- Partner: Ana is the business partner',
    );
  });

  it('drops the least important facts past the size cap', () => {
    const big = Array.from({ length: 60 }, (_, i) =>
      fact(`Fact ${i}`, 'x'.repeat(100)),
    );
    const block = buildOwnerMemoryBlock(big);
    expect(block).toContain('Fact 0:');
    expect(block).not.toContain('Fact 59:');
    expect(block.length).toBeLessThan(OWNER_MEMORY_BLOCK_MAX_CHARS + 600);
  });

  it('is empty when nothing is known', () => {
    expect(buildOwnerMemoryBlock([])).toBe('');
  });

  it('goes into the prompt when given', async () => {
    const prompt = await buildSystemPrompt({
      agentId: 'a1',
      basePrompt: 'BASE',
      ownerMemories: [fact('Short answers', 'Prefers short answers')],
    });
    expect(prompt).toContain('Prefers short answers');
  });

  it('is allowed in the web UI and the owner chat, never with a customer', () => {
    expect(ownerMemoriesAllowed({ timezone: 'UTC' })).toBe(true);
    const conversation = {
      channelType: 'whatsapp',
      channelId: 'wa',
      senderId: '5215550000000',
    };
    expect(
      ownerMemoriesAllowed({
        timezone: 'UTC',
        conversation: { ...conversation, isOwner: true },
      }),
    ).toBe(true);
    expect(
      ownerMemoriesAllowed({
        timezone: 'UTC',
        conversation: { ...conversation, isOwner: false },
      }),
    ).toBe(false);
  });
});
