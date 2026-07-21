import { describe, it, expect } from 'vitest';
import {
  mcpServerConfigSchema,
  appConfigSchema,
  whatsappChannelConfigSchema,
} from './app-config';

describe('mcpServerConfigSchema', () => {
  describe('stdio transport', () => {
    it('should parse valid stdio server config with minimal fields', () => {
      const config = {
        id: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('filesystem');
        expect(result.data.transport).toBe('stdio');
        expect(result.data.command).toBe('npx');
        expect(result.data.args).toEqual([
          '-y',
          '@modelcontextprotocol/server-filesystem',
          '/workspace',
        ]);
      }
    });

    it('should parse valid stdio server config with all fields', () => {
      const config = {
        id: 'github',
        name: 'GitHub Tools',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('GitHub Tools');
        expect(result.data.env).toEqual({ GITHUB_TOKEN: '${GITHUB_TOKEN}' });
      }
    });

    it('should reject stdio without command', () => {
      const config = {
        id: 'bad',
        transport: 'stdio',
        args: ['-y', 'something'],
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) =>
            i.message.includes('stdio transport requires command'),
          ),
        ).toBe(true);
      }
    });
  });

  describe('http transport', () => {
    it('should parse valid http server config', () => {
      const config = {
        id: 'http-api',
        name: 'HTTP API Server',
        transport: 'http',
        url: 'http://localhost:3000/mcp',
        headers: { Authorization: 'Bearer test-key' },
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transport).toBe('http');
        expect(result.data.url).toBe('http://localhost:3000/mcp');
        expect(result.data.headers).toEqual({
          Authorization: 'Bearer test-key',
        });
      }
    });

    it('should reject http without url', () => {
      const config = {
        id: 'bad',
        transport: 'http',
        headers: { Authorization: 'Bearer test' },
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) =>
            i.message.includes('http transport requires url'),
          ),
        ).toBe(true);
      }
    });

    it('should reject invalid url', () => {
      const config = {
        id: 'bad',
        transport: 'http',
        url: 'not-a-valid-url',
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('common validation', () => {
    it('should require id field', () => {
      const config = {
        transport: 'stdio',
        command: 'npx',
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty id', () => {
      const config = {
        id: '',
        transport: 'stdio',
        command: 'npx',
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject invalid transport type', () => {
      const config = {
        id: 'test',
        transport: 'websocket',
        command: 'npx',
      };
      const result = mcpServerConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});

describe('appConfigSchema with mcpServers', () => {
  const minimalValidConfig = {
    version: 1,
    defaults: {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      agentId: 'default',
    },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        vendorFamily: 'openai-compatible',
        enabled: true,
        models: [
          {
            id: 'gpt-4o-mini',
            name: 'GPT-4o Mini',
          },
        ],
      },
    ],
    agents: [
      {
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o-mini',
        enabled: true,
      },
    ],
  };

  it('should parse config without mcpServers', () => {
    const result = appConfigSchema.safeParse(minimalValidConfig);
    expect(result.success).toBe(true);
  });

  it('should parse config with empty mcpServers array', () => {
    const config = {
      ...minimalValidConfig,
      mcpServers: [],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toEqual([]);
    }
  });

  it('should parse config with valid mcpServers', () => {
    const config = {
      ...minimalValidConfig,
      mcpServers: [
        {
          id: 'filesystem',
          name: 'Filesystem Tools',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
        },
        {
          id: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
      ],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toHaveLength(2);
      expect(result.data.mcpServers?.[0]?.id).toBe('filesystem');
      expect(result.data.mcpServers?.[1]?.id).toBe('github');
    }
  });

  it('should reject duplicate mcpServer ids', () => {
    const config = {
      ...minimalValidConfig,
      mcpServers: [
        {
          id: 'duplicate',
          transport: 'stdio',
          command: 'npx',
          args: ['server1'],
        },
        {
          id: 'duplicate',
          transport: 'stdio',
          command: 'npx',
          args: ['server2'],
        },
      ],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Duplicate MCP server id'),
        ),
      ).toBe(true);
    }
  });

  it('should reject invalid mcpServer config in array', () => {
    const config = {
      ...minimalValidConfig,
      mcpServers: [
        {
          id: 'bad',
          transport: 'stdio',
          // missing command
        },
      ],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('channel config validation', () => {
  const baseConfig = {
    version: 1,
    defaults: {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      agentId: 'default',
    },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        vendorFamily: 'openai-compatible',
        enabled: true,
        models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
      },
    ],
    agents: [
      {
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o-mini',
        enabled: true,
      },
    ],
  };

  it('accepts a valid whatsapp channel config', () => {
    const result = appConfigSchema.safeParse({
      ...baseConfig,
      channels: [
        {
          type: 'whatsapp',
          id: 'personal',
          agentId: 'my-agent',
          enabled: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate channel ids', () => {
    const result = appConfigSchema.safeParse({
      ...baseConfig,
      channels: [
        { type: 'whatsapp', id: 'dup', agentId: 'a', enabled: true },
        { type: 'whatsapp', id: 'dup', agentId: 'b', enabled: true },
      ],
    });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.message).toContain('Duplicate channel id');
  });

  it('accepts channels: undefined (backwards compatible)', () => {
    const result = appConfigSchema.safeParse({ ...baseConfig });
    expect(result.success).toBe(true);
    expect(result.data?.channels).toBeUndefined();
  });

  it('rejects unknown channel type', () => {
    const result = appConfigSchema.safeParse({
      ...baseConfig,
      channels: [{ type: 'unknown', id: 'x', agentId: 'y', enabled: true }],
    });
    expect(result.success).toBe(false);
  });

  it('applies enabled default of true', () => {
    const result = whatsappChannelConfigSchema.parse({
      type: 'whatsapp',
      id: 'test',
      agentId: 'agent',
    });
    expect(result.enabled).toBe(true);
  });
});

describe('appConfigSchema agent model validation', () => {
  const base = {
    version: 1,
    defaults: {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      agentId: 'default',
    },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        vendorFamily: 'openai-compatible',
        enabled: true,
        models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
      },
    ],
    agents: [
      {
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o-mini',
        enabled: true,
      },
    ],
  };

  it('should accept a valid agent model reference', () => {
    const result = appConfigSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('should reject agent model referencing an unknown model id', () => {
    const config = {
      ...base,
      agents: [{ ...base.agents[0], model: 'openai/does-not-exist' }],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('model') &&
            i.message.includes('Unknown model "does-not-exist"'),
        ),
      ).toBe(true);
    }
  });

  it('should reject agent model referencing an unknown provider', () => {
    const config = {
      ...base,
      agents: [{ ...base.agents[0], model: 'anthropic/claude-3' }],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('model') &&
            i.message.includes('Unknown provider "anthropic"'),
        ),
      ).toBe(true);
    }
  });

  it('should reject agent model with invalid format (missing slash)', () => {
    const config = {
      ...base,
      agents: [{ ...base.agents[0], model: 'gpt-4o-mini' }],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes('Expected "providerId/modelId"'),
        ),
      ).toBe(true);
    }
  });
});

describe('appConfigSchema defaults model validation', () => {
  const base = {
    version: 1,
    defaults: {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      agentId: 'default',
    },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        vendorFamily: 'openai-compatible',
        enabled: true,
        models: [{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
      },
    ],
    agents: [
      {
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o-mini',
        enabled: true,
      },
    ],
  };

  it('should accept a valid defaults.modelId', () => {
    const result = appConfigSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('should reject defaults.modelId not listed in the default provider models', () => {
    const config = {
      ...base,
      defaults: { ...base.defaults, modelId: 'gpt-5' },
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('modelId') &&
            i.message.includes('Unknown default model "gpt-5"'),
        ),
      ).toBe(true);
    }
  });

  it('should reject defaults.providerId not in providers list', () => {
    const config = {
      ...base,
      defaults: { ...base.defaults, providerId: 'anthropic' },
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('providerId') &&
            i.message.includes('Unknown default provider "anthropic"'),
        ),
      ).toBe(true);
    }
  });
});

describe('appConfigSchema disabled model validation', () => {
  const base = {
    version: 1,
    defaults: {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      agentId: 'default',
    },
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        vendorFamily: 'openai-compatible',
        enabled: true,
        models: [
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', enabled: false },
          { id: 'gpt-4o', name: 'GPT-4o', enabled: true },
        ],
      },
    ],
    agents: [
      {
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o-mini',
        enabled: true,
      },
    ],
  };

  it('should reject defaults.modelId pointing to a disabled model', () => {
    const result = appConfigSchema.safeParse(base);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('modelId') &&
            i.message.includes(
              'Default model "gpt-4o-mini" is disabled in provider "openai"',
            ),
        ),
      ).toBe(true);
    }
  });

  it('should reject agent model pointing to a disabled model', () => {
    const config = {
      ...base,
      defaults: { ...base.defaults, modelId: 'gpt-4o' },
      agents: [{ ...base.agents[0], model: 'openai/gpt-4o-mini' }],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('model') &&
            i.message.includes(
              'Model "gpt-4o-mini" is disabled in provider "openai"',
            ),
        ),
      ).toBe(true);
    }
  });

  it('should reject provider defaultModel pointing to a disabled model', () => {
    const config = {
      ...base,
      defaults: { ...base.defaults, modelId: 'gpt-4o' },
      providers: [
        {
          ...base.providers[0],
          defaultModel: 'gpt-4o-mini',
        },
      ],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) =>
            i.path.includes('defaultModel') &&
            i.message.includes(
              'Default model "gpt-4o-mini" is disabled in provider "openai"',
            ),
        ),
      ).toBe(true);
    }
  });

  it('should accept config when disabled models are not referenced', () => {
    const config = {
      ...base,
      defaults: { ...base.defaults, modelId: 'gpt-4o' },
      agents: [{ ...base.agents[0], model: 'openai/gpt-4o' }],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

describe('appConfigSchema unconfigured (fresh install)', () => {
  // Mirrors config/openaidy.template.json: no providers, no default
  // provider/model, and a single model-less agent.
  const freshInstall = {
    version: 1,
    defaults: { agentId: 'default' },
    providers: [],
    agents: [
      {
        id: 'default',
        name: 'Default Assistant',
        systemPrompt: 'You are an AI assistant.',
        enabled: true,
      },
    ],
  };

  it('accepts an empty providers list with no default provider/model', () => {
    const result = appConfigSchema.safeParse(freshInstall);
    expect(result.success).toBe(true);
  });

  it('accepts a model-less agent', () => {
    const result = appConfigSchema.safeParse(freshInstall);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agents[0]!.model).toBeUndefined();
    }
  });

  it('still rejects an agent whose model references an unconfigured provider', () => {
    const config = {
      ...freshInstall,
      agents: [{ ...freshInstall.agents[0], model: 'ghost/model-x' }],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('still rejects a default provider that is not configured', () => {
    const config = {
      ...freshInstall,
      defaults: { agentId: 'default', providerId: 'ghost', modelId: 'm' },
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects a default provider set without a default model', () => {
    const config = {
      ...freshInstall,
      defaults: { agentId: 'default', providerId: 'openai' },
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          vendorFamily: 'openai-compatible',
          enabled: true,
          models: [{ id: 'm', name: 'M' }],
        },
      ],
    };
    const result = appConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});
