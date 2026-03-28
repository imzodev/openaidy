import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  parseAgent,
  validateAgentIdMatch,
  toAgentSummary,
  parseModelString,
} from './schema';

describe('AgentSchema', () => {
  it('should parse a valid agent', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
    });
    expect(agent.id).toBe('test-agent');
    expect(agent.name).toBe('Test Agent');
    expect(agent.enabled).toBe(true);
    expect(agent.systemPrompt).toBe('You are a test assistant.');
    expect(agent.model).toBe('openai/gpt-4o-mini');
  });

  it('should require model field', () => {
    const result = AgentSchema.safeParse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
    });
    expect(result.success).toBe(false);
  });

  it('should allow optional fields', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      description: 'A test agent',
      tags: ['test', 'example'],
      version: 2,
    });
    expect(agent.description).toBe('A test agent');
    expect(agent.tags).toEqual(['test', 'example']);
    expect(agent.version).toBe(2);
  });
});

describe('parseModelString', () => {
  it('should parse valid model string', () => {
    const result = parseModelString('openai/gpt-4o-mini');
    expect(result).toEqual({ providerId: 'openai', modelId: 'gpt-4o-mini' });
  });

  it('should return null for invalid format', () => {
    expect(parseModelString('invalid')).toBeNull();
    expect(parseModelString('invalid/')).toBeNull();
    expect(parseModelString('/invalid')).toBeNull();
    expect(parseModelString('')).toBeNull();
  });
});

describe('parseAgent', () => {
  it('should parse valid agent JSON', () => {
    const result = parseAgent(
      {
        id: 'test-agent',
        name: 'Test Agent',
        enabled: true,
        systemPrompt: 'You are a test assistant.',
        model: 'openai/gpt-4o-mini',
      },
      'test-agent.json',
    );

    expect('id' in result && result.id).toBe('test-agent');
  });

  it('should return error for invalid agent', () => {
    const result = parseAgent(
      {
        id: 'test-agent',
        name: 'Test Agent',
        // missing required fields
      },
      'test-agent.json',
    );

    expect('filePath' in result).toBe(true);
    expect('errors' in result).toBe(true);
  });
});

describe('validateAgentIdMatch', () => {
  it('should return true when id matches filename', () => {
    expect(validateAgentIdMatch('my-agent', 'my-agent.json')).toBe(true);
  });

  it('should return false when id does not match filename', () => {
    expect(validateAgentIdMatch('my-agent', 'other-agent.json')).toBe(false);
  });
});

describe('toAgentSummary', () => {
  it('should convert agent to summary', () => {
    const agent = AgentSchema.parse({
      id: 'test-agent',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'You are a test assistant.',
      model: 'openai/gpt-4o-mini',
      description: 'A test agent',
      tags: ['test'],
    });

    const summary = toAgentSummary(agent);
    expect(summary.id).toBe('test-agent');
    expect(summary.name).toBe('Test Agent');
    expect(summary.description).toBe('A test agent');
    expect(summary.enabled).toBe(true);
    expect(summary.tags).toEqual(['test']);
    expect(summary.model).toBe('openai/gpt-4o-mini');
    expect('systemPrompt' in summary).toBe(false);
  });
});
