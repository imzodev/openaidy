import { describe, it, expect } from 'vitest';
import {
  AgentSchema,
  AgentDefaultsSchema,
  parseAgent,
  validateAgentIdMatch,
  toAgentSummary,
  type Agent,
} from './schema';

describe('AgentDefaultsSchema', () => {
  it('should parse valid defaults', () => {
    const defaults = AgentDefaultsSchema.parse({
      providerId: 'openai',
      modelId: 'gpt-4',
      temperature: 0.7,
      maxTokens: 4096,
    });
    
    expect(defaults.providerId).toBe('openai');
    expect(defaults.modelId).toBe('gpt-4');
    expect(defaults.temperature).toBe(0.7);
    expect(defaults.maxTokens).toBe(4096);
  });

  it('should allow empty defaults', () => {
    const defaults = AgentDefaultsSchema.parse({});
    expect(defaults.providerId).toBeUndefined();
    expect(defaults.modelId).toBeUndefined();
  });

  it('should reject negative temperature', () => {
    const result = AgentDefaultsSchema.safeParse({ temperature: -1 });
    expect(result.success).toBe(false);
  });

  it('should reject temperature > 2', () => {
    const result = AgentDefaultsSchema.safeParse({ temperature: 3 });
    expect(result.success).toBe(false);
  });

  it('should reject negative maxTokens', () => {
    const result = AgentDefaultsSchema.safeParse({ maxTokens: -100 });
    expect(result.success).toBe(false);
  });
});

describe('AgentSchema', () => {
  const validAgent = {
    id: 'test-agent',
    name: 'Test Agent',
    enabled: true,
    systemPrompt: 'You are a test assistant.',
    defaults: {},
  };

  it('should parse a valid agent', () => {
    const agent = AgentSchema.parse(validAgent);
    expect(agent.id).toBe('test-agent');
    expect(agent.name).toBe('Test Agent');
    expect(agent.enabled).toBe(true);
    expect(agent.systemPrompt).toBe('You are a test assistant.');
  });

  it('should reject missing id', () => {
    const result = AgentSchema.safeParse({ ...validAgent, id: undefined });
    expect(result.success).toBe(false);
  });

  it('should reject empty id', () => {
    const result = AgentSchema.safeParse({ ...validAgent, id: '' });
    expect(result.success).toBe(false);
  });

  it('should reject missing name', () => {
    const result = AgentSchema.safeParse({ ...validAgent, name: undefined });
    expect(result.success).toBe(false);
  });

  it('should reject missing enabled', () => {
    const result = AgentSchema.safeParse({ ...validAgent, enabled: undefined });
    expect(result.success).toBe(false);
  });

  it('should reject missing systemPrompt', () => {
    const result = AgentSchema.safeParse({ ...validAgent, systemPrompt: undefined });
    expect(result.success).toBe(false);
  });

  it('should reject empty systemPrompt', () => {
    const result = AgentSchema.safeParse({ ...validAgent, systemPrompt: '' });
    expect(result.success).toBe(false);
  });

  it('should allow optional fields', () => {
    const agent = AgentSchema.parse({
      ...validAgent,
      description: 'A description',
      tools: ['tool1', 'tool2'],
      tags: ['tag1', 'tag2'],
      metadata: { key: 'value' },
    });
    
    expect(agent.description).toBe('A description');
    expect(agent.tools).toEqual(['tool1', 'tool2']);
    expect(agent.tags).toEqual(['tag1', 'tag2']);
    expect(agent.metadata).toEqual({ key: 'value' });
  });

  it('should default version to 1', () => {
    const agent = AgentSchema.parse(validAgent);
    expect(agent.version).toBe(1);
  });

  it('should allow custom version', () => {
    const agent = AgentSchema.parse({ ...validAgent, version: 2 });
    expect(agent.version).toBe(2);
  });
});

describe('parseAgent', () => {
  it('should return agent on valid input', () => {
    const json = {
      id: 'test',
      name: 'Test',
      enabled: true,
      systemPrompt: 'Prompt',
      defaults: {},
    };
    
    const result = parseAgent(json, 'test.json');
    
    expect('errors' in result).toBe(false);
    expect((result as Agent).id).toBe('test');
  });

  it('should return validation error on invalid input', () => {
    const json = {
      id: 'test',
      // missing name
      enabled: true,
      systemPrompt: 'Prompt',
      defaults: {},
    };
    
    const result = parseAgent(json, 'test.json');
    
    expect('errors' in result).toBe(true);
    if ('errors' in result) {
      expect(result.errors).toBeDefined();
    }
  });
});

describe('validateAgentIdMatch', () => {
  it('should return true when id matches filename', () => {
    expect(validateAgentIdMatch('my-agent', 'my-agent.json')).toBe(true);
  });

  it('should return false when id does not match filename', () => {
    expect(validateAgentIdMatch('my-agent', 'other-agent.json')).toBe(false);
  });

  it('should handle filenames without path', () => {
    // The function expects just filenames, not full paths (as used with fs.readdirSync)
    expect(validateAgentIdMatch('agent', 'agent.json')).toBe(true);
  });
});

describe('toAgentSummary', () => {
  it('should convert agent to summary', () => {
    const agent: Agent = {
      id: 'test',
      name: 'Test Agent',
      enabled: true,
      systemPrompt: 'Prompt',
      defaults: { providerId: 'openai' },
      version: 1,
    };
    
    const summary = toAgentSummary(agent);
    
    expect(summary.id).toBe('test');
    expect(summary.name).toBe('Test Agent');
    expect(summary.enabled).toBe(true);
    expect(summary.description).toBeUndefined();
    expect(summary.tags).toBeUndefined();
  });

  it('should include optional fields in summary', () => {
    const agent: Agent = {
      id: 'test',
      name: 'Test Agent',
      description: 'A test agent',
      enabled: true,
      systemPrompt: 'Prompt',
      defaults: {},
      tags: ['tag1'],
      version: 1,
    };
    
    const summary = toAgentSummary(agent);
    
    expect(summary.description).toBe('A test agent');
    expect(summary.tags).toEqual(['tag1']);
  });
});
