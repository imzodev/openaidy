import fs from 'fs';
import path from 'path';
import {
  AgentSchema,
  type Agent,
  type AgentSummary,
  type AgentValidationError,
  validateAgentIdMatch,
  toAgentSummary,
} from './schema';

/**
 * Agent registry options
 */
export type AgentRegistryOptions = {
  /** Directory containing agent JSON files */
  agentsDir?: string;
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

  constructor(options: AgentRegistryOptions = {}) {
    // Default to config/agents relative to workspace root
    this.agentsDir = options.agentsDir ?? path.join(process.cwd(), 'config', 'agents');
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

    const files = fs.readdirSync(this.agentsDir)
      .filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(this.agentsDir, file);
      const agent = this.loadAgentFile(filePath, file);
      
      if ('errors' in agent) {
        // Validation error
        const errorMessages = agent.errors
          .map(e => `  - ${e.path.join('.')}: ${e.message}`)
          .join('\n');
        throw new Error(
          `Invalid agent file ${agent.filePath}:\n${errorMessages}`
        );
      }

      // Check for duplicate IDs
      if (this.agents.has(agent.id)) {
        throw new Error(
          `Duplicate agent ID "${agent.id}" found in ${file} (already defined in another file)`
        );
      }

      this.agents.set(agent.id, agent);
    }

    this.loaded = true;
  }

  /**
   * Load a single agent file
   */
  private loadAgentFile(filePath: string, fileName: string): Agent | AgentValidationError {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (e) {
      return {
        filePath,
        errors: [{
          code: 'invalid_json',
          message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
          path: [],
        }],
      };
    }

    // Validate with Zod
    const result = AgentSchema.safeParse(json);
    if (!result.success) {
      return {
        filePath,
        errors: result.error.errors.map(e => ({
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
        errors: [{
          code: 'custom',
          message: `Agent ID "${agent.id}" does not match filename "${fileName}" (expected "${fileName.replace(/\.json$/, '')}")`,
          path: ['id'],
        }],
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
      .filter(a => a.enabled)
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
   * Reload agents from disk
   */
  reload(): void {
    this.loaded = false;
    this.load();
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
export function createAgentRegistry(options?: AgentRegistryOptions): AgentRegistry {
  const registry = new AgentRegistry(options);
  registry.load();
  return registry;
}
