import type { AgentPersonalityService } from '../agents/personality-service';
import type { SkillRegistry } from '../skills';
import { sanitizeSkillBody } from '../skills/sanitize.js';
import type { ProviderServices } from '../providers';
import { autoFillPersonalityFiles } from './auto-fill-personality.js';
import type { ToolDefinition } from '@openaidy/runtime';
import type { WorkspacePermissionsInfo } from '../types.js';
import { ALL_TOOL_METAS } from '../tools/catalog.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillMd } from '../skills/parser.js';

export type BuildSystemPromptOptions = {
  agentId: string;
  basePrompt: string;
  skillIds?: string[] | undefined;
  personalityService?: AgentPersonalityService | undefined;
  skillRegistry?: SkillRegistry | undefined;
  /** When true and providers are supplied, auto-fill blank personality files before injection */
  isFirstMessage?: boolean | undefined;
  /** The user's message content — used for personality auto-fill context */
  userMessage?: string | undefined;
  /** Provider services — required for personality auto-fill */
  providers?: ProviderServices | undefined;
  /** Tools available to this agent for generating TOOL_GUIDELINES block */
  tools?: ToolDefinition[] | undefined;
  /** Workspace permissions for honest capability reporting */
  workspacePermissions?: WorkspacePermissionsInfo | undefined;
  /** Base directory for agent workspaces (to resolve agent workspace skills) */
  workspaceBaseDir?: string | undefined;
};

/**
 * Load skill definitions from an agent's workspace skills directory.
 * Returns a Map of skillId -> SkillDefinition for skills found.
 */
function loadAgentWorkspaceSkills(
  agentId: string,
  workspaceBaseDir?: string,
): Map<
  string,
  { id: string; name: string; description: string; body: string }
> {
  const skills = new Map<
    string,
    { id: string; name: string; description: string; body: string }
  >();
  if (!workspaceBaseDir) return skills;

  const agentSkillsDir = join(workspaceBaseDir, agentId, 'skills');
  if (!existsSync(agentSkillsDir)) return skills;

  let subdirs: string[];
  try {
    subdirs = readdirSync(agentSkillsDir);
  } catch {
    return skills;
  }

  for (const id of subdirs) {
    const skillFile = join(agentSkillsDir, id, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    try {
      const content = readFileSync(skillFile, 'utf-8');
      const result = parseSkillMd(content, id, skillFile);
      if ('errors' in result) continue;
      skills.set(id, result);
    } catch {
      // skip unreadable files
    }
  }

  return skills;
}

/**
 * Build the full system prompt for an agent.
 *
 * Injection order:
 * 1. Base system prompt
 * 2. Personality markdown files (AGENT_IDENTITY, USER_CONTEXT, MISSION_CONTEXT, RULES)
 * 3. Skill bodies wrapped in [SKILL_CONTEXTS] delimiters
 *
 * Skill bodies are sanitized and wrapped in structural delimiters to prevent
 * prompt injection — content inside is treated as context data, not instructions.
 */
export async function buildSystemPrompt(
  options: BuildSystemPromptOptions,
): Promise<string> {
  const {
    agentId,
    basePrompt,
    skillIds,
    personalityService,
    skillRegistry,
    isFirstMessage,
    userMessage,
    providers,
    tools,
    workspacePermissions,
    workspaceBaseDir,
  } = options;

  // Auto-fill blank personality files on first message of a session
  if (isFirstMessage && personalityService && providers && userMessage) {
    await autoFillPersonalityFiles({
      agentId,
      agentSystemPrompt: basePrompt,
      userFirstMessage: userMessage,
      personalityService,
      providers,
    });
  }

  let prompt = basePrompt;

  if (personalityService) {
    const blocks = await personalityService.readAllForInjection(agentId);
    for (const { meta, content } of blocks) {
      prompt += `\n\n[${meta.systemPromptBlock}]\n${content}\n[/${meta.systemPromptBlock}]`;
    }

    // If this is the first message and some personality files are still unset,
    // inject a targeted onboarding instruction so the agent asks specific questions.
    if (isFirstMessage) {
      const blankLabels = await personalityService.getBlankFileLabels(agentId);
      if (blankLabels.length > 0) {
        prompt += `\n\n[ONBOARDING]\nSome context about you and the user has not been configured yet: ${blankLabels.join(', ')}. Before answering the user's message, greet them warmly, then ask them specific onboarding questions to fill in what is missing — one thing at a time, starting with the most important. Be concrete and give 2-3 short examples per question so the user knows what kind of answer to give. For Agent Identity: ask what name and emoji they would like, and what tone (e.g. "direct and concise", "warm and encouraging", "formal and precise"). For User Profile: ask their name, role, and how technical they are (e.g. "senior engineer", "product designer", "non-technical founder"). For Mission: ask what project or goal they are working on and the main technology or tools involved. For Rules: ask if there are any hard constraints the agent must always follow (e.g. "always respond in Spanish", "never suggest paid tools").\n\nYou have access to the \`present_choices\` tool. For each onboarding question, use it to present 3–4 concrete example answers as selectable options rather than asking open-endedly. The user can pick one or ignore the card and type freely.\n[/ONBOARDING]`;
      }
    }
  }

  if (skillIds?.length && skillRegistry) {
    const bodies = skillRegistry
      .getSkillsForAgent(skillIds)
      .map((s) => sanitizeSkillBody(s.body))
      .filter(Boolean)
      .join('\n\n---\n\n');

    // Also load agent workspace skills (override global skills with same ID)
    const agentWorkspaceSkills = loadAgentWorkspaceSkills(
      agentId,
      workspaceBaseDir,
    );
    const workspaceSkillBodies = skillIds
      .map((id) => agentWorkspaceSkills.get(id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
      .map((s) => sanitizeSkillBody(s.body))
      .filter(Boolean)
      .join('\n\n---\n\n');

    const allBodies = [bodies, workspaceSkillBodies]
      .filter(Boolean)
      .join('\n\n---\n\n');
    if (allBodies) {
      prompt += '\n\n[SKILL_CONTEXTS]\n' + allBodies + '\n[/SKILL_CONTEXTS]';
    }
  }

  // Inject tool guidelines with honest information about available tools and workspace permissions
  if (tools?.length) {
    prompt += buildToolGuidelinesBlock(tools, workspacePermissions);
  }
  return prompt;
}

/**
 * Build the TOOL_GUIDELINES block with honest information about available tools.
 * This helps agents understand which tools they have access to and when to use each.
 */
function buildToolGuidelinesBlock(
  tools: ToolDefinition[],
  workspacePermissions?: WorkspacePermissionsInfo | undefined,
): string {
  // Build map of available tools for quick lookup
  const availableTools = new Map(tools.map((t) => [t.name, t]));

  // Build the tools list showing available vs unavailable
  const toolsList = ALL_TOOL_METAS.map((tool) => {
    const isAvailable = availableTools.has(tool.name);
    const status = isAvailable ? '[ENABLED]' : '[NOT ENABLED]';
    return `  ${status} ${tool.name} (${tool.category}): ${tool.description}`;
  }).join('\n');

  // Check for specific capabilities
  const hasAgentsInvoke = availableTools.has('agents_invoke');
  const hasAgentsInvokeAwait = availableTools.has('agents_invoke_await');

  // Use workspace permissions if provided, otherwise fall back to tool availability
  const hasWorkspaceRead =
    workspacePermissions?.read ?? availableTools.has('workspace_read');
  const hasWorkspaceWrite =
    workspacePermissions?.write ?? availableTools.has('workspace_write');
  const hasWorkspaceList =
    workspacePermissions?.list ?? availableTools.has('workspace_list');
  const hasWorkspaceDelete =
    workspacePermissions?.delete ?? availableTools.has('workspace_delete');

  let guidelines = `

[TOOL_GUIDELINES]
## All Tools in This System

${toolsList}

## Your Current Access
You have ${tools.length} tool(s) ENABLED (marked [ENABLED] above). Tools marked [NOT ENABLED] exist in the system but are NOT configured for you.

## CRITICAL RULES FOR TOOL SELECTION
`;

  // Agent tools guidance
  if (hasAgentsInvokeAwait || hasAgentsInvoke) {
    guidelines += `
### Agent Invocation Tools
`;
    if (hasAgentsInvokeAwait) {
      guidelines += `- agents_invoke_await: USE THIS when you need the agent's response (questions, content requests, validation, sequential tasks)
`;
    }
    if (hasAgentsInvoke) {
      guidelines += `- agents_invoke: USE THIS for fire-and-forget tasks (logging, background processing, independent research)
`;
    }
    if (hasAgentsInvoke && hasAgentsInvokeAwait) {
      guidelines += `- DECISION RULE: If the user asks you to invoke an agent and implies they want a result ("ask X to do Y"), ALWAYS use agents_invoke_await, NOT agents_invoke + sessions_read.
`;
    }
  }

  // Workspace capabilities section - CRITICAL for honesty
  guidelines += `
### Your Workspace Capabilities (BE EXPLICITLY HONEST ABOUT THESE)
`;
  if (hasWorkspaceRead) {
    guidelines += `- READ: ✅ You CAN read files from your workspace
`;
  } else {
    guidelines += `- READ: ❌ You CANNOT read files (workspace_read not enabled)
`;
  }

  if (hasWorkspaceWrite) {
    guidelines += `- WRITE: ✅ You CAN create and modify files in your workspace
`;
  } else {
    guidelines += `- WRITE: ❌ You CANNOT write files (workspace_write not enabled)
`;
  }

  if (hasWorkspaceList) {
    guidelines += `- LIST: ✅ You CAN list files in your workspace
`;
  } else {
    guidelines += `- LIST: ❌ You CANNOT list files (workspace_list not enabled)
`;
  }

  if (hasWorkspaceDelete) {
    guidelines += `- DELETE: ✅ You CAN delete files from your workspace
`;
  } else {
    guidelines += `- DELETE: ❌ You CANNOT delete files (workspace_delete not enabled)
`;
  }

  guidelines += `
## HONESTY REQUIREMENTS (VIOLATING THESE IS A BUG)

1. ONLY use tools marked [ENABLED] above. Do not pretend to have access to disabled tools.

2. If a user asks you to perform an action requiring a disabled tool:
   - ❌ NEVER pretend you did it
   - ✅ ALWAYS explain honestly: "I don't have access to [action]. My [tool_name] is not enabled."
   - 💡 SUGGEST alternatives if possible

3. BEFORE claiming you completed a task, VERIFY you actually used the tool successfully and got a success response.

4. If asked to write/save/create a file and you don't have workspace_write:
   Say EXPLICITLY: "I cannot write files because I don't have the workspace_write tool enabled."
   Do NOT say "I've written the file" or "I'll save it" if you can't actually do it.

5. Be UPFRONT about limitations immediately. Don't wait for the user to find out.
[/TOOL_GUIDELINES]`;

  return guidelines;
}
