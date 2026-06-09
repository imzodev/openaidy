/**
 * Builtin Tools — native, in-process tools available to agents.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HOW TO ADD A NEW TOOL CATEGORY
 * ─────────────────────────────────────────────────────────────────────
 * 1. Create a directory:  src/tools/<category>/
 * 2. Implement each tool in its own file exporting a `create*Tool(deps): BuiltinTool`.
 * 3. Add a category barrel:  src/tools/<category>/index.ts
 *    that exports a `create<Category>Tools(deps): BuiltinTool[]` factory.
 * 4. Import the factory below and call it inside `createBuiltinToolRegistry`.
 * 5. Add the new tool names to the relevant agent configs under `nativeTools`.
 *
 * HOW TO ADD A SINGLE TOOL TO AN EXISTING CATEGORY
 * ─────────────────────────────────────────────────────────────────────
 * 1. Add a new file in the category directory.
 * 2. Export the `create*Tool` factory from the category barrel.
 * 3. Register it in the category's `create<Category>Tools` factory.
 * 4. Add the tool name to agent configs.
 * ─────────────────────────────────────────────────────────────────────
 */

import { BuiltinToolRegistry } from './registry';
import { createWorkspaceTools } from './workspace';
import { createExecTools } from './exec';
import { createSkillTools } from './skills';
import { createAddonTools } from './addons';
import { createAgentTools } from './agents';
import type { AgentToolsDeps } from './agents';
import { createWebTools } from './web';
import { createSessionTools } from './sessions';
import { createMemoryTools } from './memory';
import type { MemoryToolDeps } from './memory';
import { presentChoicesTool } from './present-choices';
import { createTaskTools } from './tasks';
import type { PulseToolDeps } from './pulses';
import { createPulseTools } from './pulses';
import { createTaskScheduleTools } from './task-schedules';
import type { WorkspaceService } from '../workspace/service';
import type { ExecService } from '../exec/service';
import type { SkillRegistry } from '../skills/index';
import type { AddonToolDeps } from './addons';
import type { SessionMessageService } from '../sessions/service';
import type { TaskService } from '../tasks/service';
import type { TaskScheduleService } from '../tasks/schedule-service.js';

export { BuiltinToolRegistry } from './registry';
export { createWorkspaceTools } from './workspace';
export { createExecTools } from './exec';
export { createSkillTools } from './skills';
export { createAddonTools } from './addons';
export type { AddonToolDeps } from './addons';
export { createAgentTools } from './agents';
export type { AgentToolsDeps } from './agents';
export { createWebTools } from './web';
export { createSessionTools } from './sessions';
export { createMemoryTools } from './memory';
export type { MemoryToolDeps } from './memory';
export { createPulseTools } from './pulses';
export type { PulseToolDeps } from './pulses';
export { createTaskScheduleTools } from './task-schedules';
export type { TaskScheduleToolDeps } from './task-schedules';

export type BuiltinToolRegistryDeps = {
  workspace: WorkspaceService;
  exec?: ExecService;
  skills?: { registry: SkillRegistry };
  addons?: AddonToolDeps;
  agents?: AgentToolsDeps;
  web?: boolean;
  sessions?: { getSessionService: () => SessionMessageService };
  memory?: MemoryToolDeps;
  getTaskService?: () => TaskService | undefined;
  getPlanningService?: () => import('../planning').PlanningService | undefined;
  pulses?: PulseToolDeps;
  /**
   * Optional. When provided, the recurring-tasks agent tools
   * (task_schedules_*) are registered. The getter pattern matches
   * the rest of the registry: the service is constructed in
   * app.ts and looked up lazily so the tools degrade gracefully when
   * the database is not configured.
   */
  getTaskScheduleService?: () => TaskScheduleService | undefined;
};

/**
 * Build and return the populated BuiltinToolRegistry for the server.
 *
 * Each tool category receives the services it needs via dependency injection.
 * The registry is then passed to SessionMessageService so it can look up and
 * call native tools during the agent tool-call loop — completely separate from
 * the MCP path.
 */
export function createBuiltinToolRegistry(
  deps: BuiltinToolRegistryDeps,
): BuiltinToolRegistry {
  const registry = new BuiltinToolRegistry();

  for (const tool of createWorkspaceTools(deps.workspace)) {
    registry.register(tool);
  }

  if (deps.exec) {
    for (const tool of createExecTools(deps.exec, deps.workspace)) {
      registry.register(tool);
    }
  }

  if (deps.skills) {
    for (const tool of createSkillTools(deps.skills.registry, deps.workspace)) {
      registry.register(tool);
    }
  }

  if (deps.addons) {
    for (const tool of createAddonTools(deps.addons)) {
      registry.register(tool);
    }
  }

  if (deps.agents) {
    for (const tool of createAgentTools(deps.agents)) {
      registry.register(tool);
    }
  }

  if (deps.sessions) {
    for (const tool of createSessionTools(deps.sessions)) {
      registry.register(tool);
    }
  }

  if (deps.web) {
    for (const tool of createWebTools()) {
      registry.register(tool);
    }
  }

  if (deps.memory) {
    for (const tool of createMemoryTools(deps.memory)) {
      registry.register(tool);
    }
  }

  if (deps.getTaskService) {
    for (const tool of createTaskTools(
      deps.getTaskService,
      deps.getPlanningService,
    )) {
      registry.register(tool);
    }
  }

  if (deps.pulses) {
    for (const tool of createPulseTools(deps.pulses)) {
      registry.register(tool);
    }
  }

  if (deps.getTaskScheduleService) {
    for (const tool of createTaskScheduleTools({
      getTaskScheduleService: deps.getTaskScheduleService,
    })) {
      registry.register(tool);
    }
  }

  // present_choices — self-contained tool, no external dependencies
  registry.register(presentChoicesTool);

  return registry;
}
