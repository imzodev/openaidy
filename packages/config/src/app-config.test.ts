import { describe, expect, it } from 'vitest';
import { appConfigSchema } from './app-config';

describe('appAgentConfigSchema workspace support', () => {
  it('preserves agent workspace configuration from app config', () => {
    const parsed = appConfigSchema.parse({
      version: 1,
      defaults: {
        providerId: 'zai',
        modelId: 'glm-5',
        agentId: 'default',
      },
      providers: [
        {
          id: 'zai',
          name: 'Zai',
          enabled: true,
          vendorFamily: 'openai-compatible',
          models: [{ id: 'glm-5', name: 'GLM 5' }],
        },
      ],
      agents: [
        {
          id: 'default',
          name: 'Default Assistant',
          enabled: true,
          systemPrompt: 'You are helpful.',
          model: 'zai/glm-5',
          workspace: {
            enabled: true,
            defaultPermissions: {
              read: true,
              write: true,
              delete: false,
              list: true,
            },
            workspaces: [
              {
                path: 'default',
                permissions: {
                  read: true,
                  write: true,
                  delete: false,
                  list: true,
                },
              },
            ],
          },
        },
      ],
    });

    expect(parsed.agents[0]?.workspace?.enabled).toBe(true);
    expect(parsed.agents[0]?.workspace?.workspaces[0]?.path).toBe('default');
    expect(parsed.agents[0]?.workspace?.defaultPermissions?.write).toBe(true);
  });
});
