import fs from 'fs';
import path from 'path';
import {
  AgentSchema,
  type Agent,
  type AgentSummary,
  type AgentValidationError,
  type McpServerRef,
  validateAgentIdMatch,
  toAgentSummary,
} from './schema';
import type { CreateAgentInput } from '../types';
import type { AgentIdentity } from '@openaidy/shared-types';

/**
 * Agent registry options
 */
export type AgentRegistryOptions = {
  /** Directory containing agent JSON files */
  agentsDir?: string;
  /** Initial in-memory agents */
  initialAgents?: Agent[];
  /** Path to the main openaidy.json config file used for persisting agent changes */
  configPath?: string;
};

/**
 * Agent registry service
 *
 * Loads, validates, caches, and exposes agents from JSON files.
 * Agents are stored in config/agents/*.json
 */
export class AgentRegistry {
  private readonly agentsDir: string;
  private readonly agents: Map<string, Agent> = new Map();
  private loaded = false;
  private configPath: string | undefined;

  constructor(options: AgentRegistryOptions = {}) {
    // Default to config/agents relative to workspace root
    this.agentsDir =
      options.agentsDir ?? path.join(process.cwd(), 'config', 'agents');
    this.configPath = options.configPath;

    if (options.initialAgents) {
      this.replaceAll(options.initialAgents);
    }
  }

  /**
   * Set (or update) the path to the main openaidy.json config file.
   * Called by AppConfigService after it resolves the path.
   */
  setConfigPath(configPath: string): void {
    this.configPath = configPath;
  }

  /**
   * Load all agents from the agents directory
   *
   * @throws Error if any agent file is invalid
   */
  load(): void {
    this.agents.clear();

    // Check if directory exists
    if (!fs.existsSync(this.agentsDir)) {
      // No agents directory - that's okay, just no agents
      this.loaded = true;
      return;
    }

    const files = fs
      .readdirSync(this.agentsDir)
      .filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(this.agentsDir, file);
      const agent = this.loadAgentFile(filePath, file);

      if ('errors' in agent) {
        // Validation error
        const errorMessages = agent.errors
          .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
          .join('\n');
        throw new Error(
          `Invalid agent file ${agent.filePath}:\n${errorMessages}`,
        );
      }

      // Check for duplicate IDs
      if (this.agents.has(agent.id)) {
        throw new Error(
          `Duplicate agent ID "${agent.id}" found in ${file} (already defined in another file)`,
        );
      }

      this.agents.set(agent.id, agent);
    }

    this.loaded = true;
  }

  /**
   * Load a single agent file
   */
  private loadAgentFile(
    filePath: string,
    fileName: string,
  ): Agent | AgentValidationError {
    const content = fs.readFileSync(filePath, 'utf-8');

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (e) {
      return {
        filePath,
        errors: [
          {
            code: 'invalid_json',
            message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
            path: [],
          },
        ],
      };
    }

    // Validate with Zod
    const result = AgentSchema.safeParse(json);
    if (!result.success) {
      return {
        filePath,
        errors: result.error.errors.map((e) => ({
          code: e.code,
          message: e.message,
          path: e.path,
        })),
      };
    }

    const agent = result.data;

    // Validate that id matches filename
    if (!validateAgentIdMatch(agent.id, fileName)) {
      return {
        filePath,
        errors: [
          {
            code: 'custom',
            message: `Agent ID "${agent.id}" does not match filename "${fileName}" (expected "${fileName.replace(/\.json$/, '')}")`,
            path: ['id'],
          },
        ],
      };
    }

    return agent;
  }

  /**
   * Ensure agents are loaded
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }

  /**
   * List all agents (summary format)
   */
  listAgents(): AgentSummary[] {
    this.ensureLoaded();
    return Array.from(this.agents.values())
      .filter((a) => a.enabled)
      .map(toAgentSummary);
  }

  /**
   * List all agents including disabled ones
   */
  listAllAgents(): AgentSummary[] {
    this.ensureLoaded();
    return Array.from(this.agents.values()).map(toAgentSummary);
  }

  /**
   * Get an agent by ID
   */
  getAgent(id: string): Agent | undefined {
    this.ensureLoaded();
    return this.agents.get(id);
  }

  /**
   * Check if an agent exists
   */
  hasAgent(id: string): boolean {
    this.ensureLoaded();
    return this.agents.has(id);
  }

  /**
   * Get MCP server references for an agent
   * Returns empty array if agent has no MCP servers configured
   */
  getMcpServers(agentId: string): McpServerRef[] {
    const agent = this.getAgent(agentId);
    if (!agent) {
      return [];
    }
    return agent.mcpServers ?? [];
  }

  /**
   * Reload agents from disk
   */
  reload(): void {
    this.loaded = false;
    this.load();
  }

  /**
   * Replace all loaded agents with an in-memory set.
   */
  replaceAll(agents: Agent[]): void {
    this.agents.clear();

    for (const agent of agents) {
      const result = AgentSchema.safeParse(agent);
      if (!result.success) {
        const errorMessages = result.error.errors
          .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
          .join('\n');
        throw new Error(
          `Invalid in-memory agent "${agent.id}":\n${errorMessages}`,
        );
      }

      if (this.agents.has(result.data.id)) {
        throw new Error(
          `Duplicate agent ID "${result.data.id}" found in in-memory config`,
        );
      }

      this.agents.set(result.data.id, result.data);
    }

    this.loaded = true;
  }

  /**
   * Read the config file, apply a mutation to the agents array, then atomically write it back.
   * No-op if configPath is not set or the file does not exist.
   */
  private persistConfig(
    mutate: (agents: Array<Record<string, unknown>>) => void,
  ): void {
    if (!this.configPath || !fs.existsSync(this.configPath)) return;
    const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as {
      agents?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(raw.agents)) raw.agents = [];
    mutate(raw.agents);
    const tempPath = `${this.configPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
    fs.renameSync(tempPath, this.configPath);
  }

  /**
   * Update the builtin tools list for an agent.
   * Patches both the in-memory registry and the main openaidy.json config file on disk.
   * Returns the updated AgentSummary or undefined if the agent was not found.
   */
  updateAgentTools(agentId: string, tools: string[]): AgentSummary | undefined {
    this.ensureLoaded();
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    const updated: Agent = {
      ...agent,
      tools: tools.length > 0 ? tools : undefined,
    };
    this.agents.set(agentId, updated);
    this.persistConfig((agents) => {
      const idx = agents.findIndex((a) => a['id'] === agentId);
      if (idx !== -1) {
        if (tools.length > 0) agents[idx]!['tools'] = tools;
        else delete agents[idx]!['tools'];
      }
    });
    return toAgentSummary(updated);
  }

  /**
   * Update the skills list for an agent.
   * Patches both the in-memory registry and the main openaidy.json config file on disk.
   * Returns the updated AgentSummary or undefined if the agent was not found.
   */
  updateAgentSkills(
    agentId: string,
    skills: string[],
  ): AgentSummary | undefined {
    this.ensureLoaded();
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    const updated: Agent = {
      ...agent,
      skills: skills.length > 0 ? skills : undefined,
    };
    this.agents.set(agentId, updated);
    this.persistConfig((agents) => {
      const idx = agents.findIndex((a) => a['id'] === agentId);
      if (idx !== -1) {
        if (skills.length > 0) agents[idx]!['skills'] = skills;
        else delete agents[idx]!['skills'];
      }
    });
    return toAgentSummary(updated);
  }

  /**
   * Append a skill ID to an agent's skills list.
   * Patches both the in-memory registry and the main openaidy.json config file on disk.
   *
   * - Throws if the agent does not exist.
   * - No-op (returns the existing agent) if the skill is already attached.
   * - Otherwise appends the skillId, persists the change, and returns the updated agent.
   */
  addSkillToAgent(agentId: string, skillId: string): Agent {
    this.ensureLoaded();
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent with ID "${agentId}" not found`);
    }

    const currentSkills = agent.skills ?? [];
    if (currentSkills.includes(skillId)) {
      return agent;
    }

    const newSkills = [...currentSkills, skillId];
    const updated: Agent = {
      ...agent,
      skills: newSkills,
    };
    this.agents.set(agentId, updated);
    this.persistConfig((agents) => {
      const idx = agents.findIndex((a) => a['id'] === agentId);
      if (idx !== -1) {
        agents[idx]!['skills'] = newSkills;
      }
    });
    return updated;
  }

  /**
   * Update the MCP server references for an agent.
   * Patches both the in-memory registry and the main openaidy.json config file on disk.
   * Returns the updated AgentSummary or undefined if the agent was not found.
   */
  updateAgentMcpServers(
    agentId: string,
    mcpServers: McpServerRef[],
  ): AgentSummary | undefined {
    this.ensureLoaded();
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    const updated: Agent = {
      ...agent,
      mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
    };
    this.agents.set(agentId, updated);
    this.persistConfig((agents) => {
      const idx = agents.findIndex((a) => a['id'] === agentId);
      if (idx !== -1) {
        if (mcpServers.length > 0) agents[idx]!['mcpServers'] = mcpServers;
        else delete agents[idx]!['mcpServers'];
      }
    });
    return toAgentSummary(updated);
  }

  /**
   * Update (or clear) the structured visual identity for an agent.
   * Patches both the in-memory registry and the main openaidy.json config file on disk.
   * Passing `null` removes the `identity` key. Returns the updated AgentSummary
   * or undefined if the agent was not found.
   */
  updateAgentIdentity(
    agentId: string,
    identity: AgentIdentity | null,
  ): AgentSummary | undefined {
    this.ensureLoaded();
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    const updated: Agent = {
      ...agent,
      identity: identity ?? undefined,
    };
    this.agents.set(agentId, updated);
    this.persistConfig((agents) => {
      const idx = agents.findIndex((a) => a['id'] === agentId);
      const entry = idx !== -1 ? agents[idx] : undefined;
      if (!entry) return;
      if (identity) entry['identity'] = identity;
      else delete entry['identity'];
    });
    return toAgentSummary(updated);
  }

  /**
   * Create a new agent from user-provided input.
   * All structural defaults (version, enabled, workspace scaffold, tags) are applied here
   * so callers never duplicate this logic. Persists to openaidy.json and registers in memory.
   * Throws if the ID already exists or validation fails.
   */
  createAgent(input: CreateAgentInput): AgentSummary {
    this.ensureLoaded();

    if (this.agents.has(input.id)) {
      throw new Error(`Agent with ID "${input.id}" already exists`);
    }

    const agent: Agent = {
      id: input.id,
      name: input.name,
      enabled: true,
      systemPrompt:
        input.systemPrompt ||
        'You are a helpful AI assistant. Be concise, accurate, and helpful.',
      model: input.model,
      description: input.description || `${input.name} agent`,
      tags: input.tags ?? [],
      skills:
        input.skills && input.skills.length > 0 ? input.skills : undefined,
      version: 1,
      identity: input.identity,
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
            path: input.id,
            permissions: { read: true, write: true, delete: false, list: true },
          },
        ],
      },
    };

    const result = AgentSchema.safeParse(agent);
    if (!result.success) {
      const msgs = result.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join(', ');
      throw new Error(`Invalid agent: ${msgs}`);
    }

    this.agents.set(result.data.id, result.data);
    this.persistConfig((agents) => {
      agents.push(result.data as unknown as Record<string, unknown>);
    });
    return toAgentSummary(result.data);
  }

  /**
   * Delete an agent by ID.
   * Removes from the in-memory map and persists to openaidy.json.
   * Returns the deleted summary, or null if not found.
   */
  deleteAgent(agentId: string): AgentSummary | null {
    this.ensureLoaded();
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    this.agents.delete(agentId);
    this.persistConfig((agents) => {
      const idx = agents.findIndex((a) => a['id'] === agentId);
      if (idx !== -1) agents.splice(idx, 1);
    });
    return toAgentSummary(agent);
  }

  /**
   * Get the number of loaded agents
   */
  get size(): number {
    this.ensureLoaded();
    return this.agents.size;
  }
}

/**
 * Create a default agent registry
 */
export function createAgentRegistry(
  options?: AgentRegistryOptions,
): AgentRegistry {
  const registry = new AgentRegistry(options);
  if (!options?.initialAgents) {
    registry.load();
  }
  return registry;
}
