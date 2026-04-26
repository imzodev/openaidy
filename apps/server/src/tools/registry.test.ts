import { describe, it, expect } from 'vitest';
import { BuiltinToolRegistry } from './registry';
import type { BuiltinTool } from '@openaidy/runtime';

function makeTool(name: string): BuiltinTool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      return { ok: true, content: `executed ${name}` };
    },
  };
}

describe('BuiltinToolRegistry', () => {
  describe('register', () => {
    it('registers a tool and returns the registry for chaining', () => {
      const registry = new BuiltinToolRegistry();
      const result = registry.register(makeTool('my_tool'));
      expect(result).toBe(registry);
    });

    it('throws when registering a duplicate tool name', () => {
      const registry = new BuiltinToolRegistry();
      registry.register(makeTool('dup_tool'));
      expect(() => registry.register(makeTool('dup_tool'))).toThrow(
        'BuiltinToolRegistry: tool "dup_tool" is already registered',
      );
    });
  });

  describe('get', () => {
    it('returns a registered tool by name', () => {
      const registry = new BuiltinToolRegistry();
      const tool = makeTool('lookup_tool');
      registry.register(tool);
      expect(registry.get('lookup_tool')).toBe(tool);
    });

    it('returns undefined for an unregistered tool', () => {
      const registry = new BuiltinToolRegistry();
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getDefinitions', () => {
    it('returns schema-only definitions (no execute) for requested names', () => {
      const registry = new BuiltinToolRegistry();
      registry.register(makeTool('tool_a'));
      registry.register(makeTool('tool_b'));

      const defs = registry.getDefinitions(['tool_a', 'tool_b']);
      expect(defs).toHaveLength(2);
      expect(defs[0]).toEqual({
        name: 'tool_a',
        description: 'Tool tool_a',
        parameters: { type: 'object', properties: {}, required: [] },
      });
      expect('execute' in defs[0]!).toBe(false);
    });

    it('silently skips names that are not registered', () => {
      const registry = new BuiltinToolRegistry();
      registry.register(makeTool('real_tool'));

      const defs = registry.getDefinitions(['real_tool', 'ghost_tool']);
      expect(defs).toHaveLength(1);
      expect(defs[0]!.name).toBe('real_tool');
    });

    it('returns empty array when no names match', () => {
      const registry = new BuiltinToolRegistry();
      expect(registry.getDefinitions(['nope'])).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      const registry = new BuiltinToolRegistry();
      registry.register(makeTool('some_tool'));
      expect(registry.getDefinitions([])).toEqual([]);
    });
  });

  describe('registeredNames', () => {
    it('returns all registered tool names', () => {
      const registry = new BuiltinToolRegistry();
      registry.register(makeTool('alpha'));
      registry.register(makeTool('beta'));
      expect(registry.registeredNames).toContain('alpha');
      expect(registry.registeredNames).toContain('beta');
      expect(registry.registeredNames).toHaveLength(2);
    });

    it('returns empty array when no tools are registered', () => {
      const registry = new BuiltinToolRegistry();
      expect(registry.registeredNames).toEqual([]);
    });
  });

  describe('tool execution via get()', () => {
    it('executes a registered tool and returns its result', async () => {
      const registry = new BuiltinToolRegistry();
      const tool: BuiltinTool = {
        name: 'echo',
        description: 'Echoes the input',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        async execute(args) {
          return { ok: true, content: String(args['text']) };
        },
      };
      registry.register(tool);

      const result = await registry
        .get('echo')!
        .execute({ text: 'hello' }, { agentId: 'agent-1' });
      expect(result).toEqual({ ok: true, content: 'hello' });
    });
  });
});
