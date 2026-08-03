import type { AgentPersonalityService } from '../agents/personality-service';
import type { SkillRegistry } from '../skills';
import { sanitizeSkillBody } from '../skills/sanitize';
import type { ProviderServices } from '../providers';
import { autoFillPersonalityFiles } from './auto-fill-personality';
import type { ToolDefinition } from '@openaidy/runtime';
import type { WorkspacePermissionsInfo } from '../types';
import type { SessionType } from '@openaidy/shared-types';
import { ALL_TOOL_METAS } from '../tools/catalog';
import { formatSessionSearchResultDocs } from '@openaidy/db';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillMd } from '../skills/parser';
import { logger } from '../lib/logger';

/**
 * The facts about an installed addon an agent needs before it can review or
 * change one: which addons exist, what each is for, and whether it is currently
 * running. File contents are deliberately not included — the agent pulls those
 * with `addon_read` for the one addon it is working on, instead of every
 * addon's source landing in every prompt.
 */
export type AddonPromptSummary = {
  /** The addon identifier the addon_* tools take (not the DB row id). */
  id: string;
  name: string;
  description?: string | undefined;
  version?: string | undefined;
  /**
   * Lifecycle state, verbatim: `enabled`, `disabled`, `installed` or `error`.
   * Passed through rather than collapsed to a boolean — an agent asked to fix a
   * broken addon needs to see `error`, not "disabled".
   */
  status: string;
};

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
  /** Session type - used to inject context-specific reminders */
  sessionType?: SessionType | undefined;
  /**
   * Addons installed on this instance, for the [ADDONS_AVAILABLE] block.
   *
   * Without this the agent has no way to know an addon exists: addons live
   * outside the workspace, so no workspace_* tool can see them, and
   * `addon_update` requires an id it would otherwise have to guess. Injected
   * only when the agent actually holds an addon tool (see below), so an agent
   * with no addon access doesn't pay for the list.
   */
  addons?: AddonPromptSummary[] | undefined;
  /**
   * Number of remaining messages that should receive ONBOARDING injection.
   * Onboarding runs until this reaches 0 or all personality files are configured.
   * Default is 0 (no onboarding).
   */
  onboardingMessagesRemaining?: number | undefined;
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
    sessionType,
    addons,
    onboardingMessagesRemaining = 0,
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

    // If onboarding messages remain, inject targeted onboarding instructions for each blank file.
    // This runs on the first message AND the first user response (onboardingMessagesRemaining = 2 initially).
    if (onboardingMessagesRemaining > 0) {
      const blankLabels = await personalityService.getBlankFileLabels(agentId);
      if (blankLabels.length > 0) {
        logger.info('Onboarding included in system prompt', {
          agentId,
          onboardingMessagesRemaining,
          blankFileCount: blankLabels.length,
        });
        // Emit blank items highest-priority first so, if the agent does
        // onboard, it asks about the most important thing.
        const ONBOARDING_PRIORITY = [
          'Mission',
          'User Profile',
          'Agent Identity',
          'Rules',
        ];
        const orderedLabels = [...blankLabels].sort(
          (a, b) =>
            ONBOARDING_PRIORITY.indexOf(a) - ONBOARDING_PRIORITY.indexOf(b),
        );

        prompt += `\n\n[ONBOARDING]`;
        prompt += `\nSome personality files are still blank: ${orderedLabels.join(', ')}. Collecting them lets you personalize future conversations, but YOU decide whether now is the right moment — judge it from the user's CURRENT message. Do NOT let onboarding override or delay what the user actually asked for.`;

        prompt += `\n\nDO NOT onboard right now — just answer or do what they asked — if the user:`;
        prompt += `\n- greets you ("hola", "buenas", "hello", "hi", "good morning"),`;
        prompt += `\n- makes small talk or thanks you,`;
        prompt += `\n- gives a concrete task or action ("create X", "fix Y", "look at Z", "review ..."),`;
        prompt += `\n- asks a focused question that wants an answer, not setup.`;
        prompt += `\nIn those cases, do exactly what they asked. You MAY add ONE short line at the END offering to set up your personality later — never replace or gate the response with onboarding questions.`;

        prompt += `\n\nDO onboard now only if the user:`;
        prompt += `\n- is openly exploring who you are ("who are you?", "what can you do?"),`;
        prompt += `\n- is explicitly setting you up ("let's get started", "configure yourself", "set up your personality"),`;
        prompt += `\n- sent an empty or too-vague message you cannot act on.`;

        prompt += `\n\nWhen you DO onboard: ask about ONE blank item at a time, highest priority first (${orderedLabels.join(
          ' → ',
        )}), using \`present_choices\` for concrete options, and stop early if the user signals they want to move on. If the user also gave a task, handle onboarding and then still do the task in the same turn.`;

        prompt += `\n\n## Saving personality answers`;
        prompt += `\nWhen the user answers an onboarding question you MUST persist it with workspace_write (NOT memory tools) — the files below are how this context is injected into future conversations.`;

        for (const label of orderedLabels) {
          if (label === 'Mission') {
            prompt += `\n\n**Mission** (MISSION.md) — ask "What is your mission for this conversation?" via \`present_choices\`: "Complete a task or project", "Learn or explore a topic", "Make a decision or get advice", "Brainstorm or generate ideas", "Solve a problem" (or let them type their own).`;
            prompt += `\n  Save: workspace_write({ path: "MISSION.md", content: "# Mission\\n\\n[User's mission]" })`;
          } else if (label === 'User Profile') {
            prompt += `\n\n**User Profile** (USER.md) — ask what to call them, their role/profession, and how technical they are; use \`present_choices\` for role/technicality.`;
            prompt += `\n  Save: workspace_write({ path: "USER.md", content: "# User Profile\\n\\nName: [..]\\nRole: [..]\\nTechnical level: [..]" })`;
          } else if (label === 'Agent Identity') {
            prompt += `\n\n**Agent Identity** (AGENT.md) — ask what name + emoji to use and what tone; use \`present_choices\` for 3-4 tone options (e.g. "direct and concise", "warm and encouraging", "formal and precise").`;
            prompt += `\n  Save: workspace_write({ path: "AGENT.md", content: "# Agent Identity\\n\\nName: [..]\\nEmoji: [..]\\nTone: [..]" })`;
          } else if (label === 'Rules') {
            prompt += `\n\n**Rules** (RULES.md) — ask "Any hard constraints or rules I should always follow?" (e.g. "always respond in Spanish", "never suggest paid tools", "always verify my work").`;
            prompt += `\n  Save: workspace_write({ path: "RULES.md", content: "# Rules\\n\\n[User's rules]" })`;
          }
        }
        prompt += `\n[/ONBOARDING]`;
      }
    }
  }

  // Inject subtask execution reminder for subtask sessions
  if (sessionType === 'subtask') {
    prompt += `

[SUBTASK_REMINDER]
You are executing a subtask in an automated multi-step workflow. Your sole purpose is to complete the objective described above.

Rules:
- Execute immediately. Do NOT ask the user for clarification, confirmation, or additional instructions.
- Deliver the actual output. The subtask is complete only when the concrete deliverable exists — e.g. a tweet is written, a file is saved, an API call is made, a summary is produced.
- Use your tools. If the objective requires fetching data, writing files, or calling APIs — do it now.
- Do NOT offer a menu of options or ask "what would you like me to do?". Pick the best approach and execute it.
- Do NOT end your response with a question or a proposal. End it with the finished work.

Your response will be automatically evaluated. Work is judged complete only if the actual deliverable is present in your response, not if you described what you could do.
[/SUBTASK_REMINDER]`;
  }

  if (skillIds?.length && skillRegistry) {
    // Load agent workspace skills to get folder names
    const agentWorkspaceSkills = loadAgentWorkspaceSkills(
      agentId,
      workspaceBaseDir,
    );

    // Build list of all available skill IDs (global + workspace)
    const globalSkills = skillRegistry.getSkillsForAgent(skillIds);
    const skillList: Array<{ id: string; name: string; description: string }> =
      [];

    for (const skill of globalSkills) {
      skillList.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
      });
    }

    // Add workspace skills that aren't already in the list
    for (const id of skillIds) {
      const wsSkill = agentWorkspaceSkills.get(id);
      if (wsSkill && !skillList.some((s) => s.id === id)) {
        skillList.push({
          id: wsSkill.id,
          name: wsSkill.name,
          description: wsSkill.description,
        });
      }
    }

    // Add [SKILLS_AVAILABLE] section with folder names
    if (skillList.length > 0) {
      const skillEntries = skillList
        .map((s) => `- ${s.id}: ${s.name} — ${s.description}`)
        .join('\n');

      prompt += `\n\n[SKILLS_AVAILABLE]\nYou have access to the following skills in your workspace:\n${skillEntries}\n\nTo use a skill, read its files with workspace_read from the skills/{skill-id}/ directory. For example: workspace_read({ path: "skills/${skillList[0]?.id ?? 'example'}/SKILL.md" })\nReading a skill loads its guidelines into your context for that task.\n[/SKILLS_AVAILABLE]`;
    }

    // Also inject full skill content as context
    const bodies = globalSkills
      .map((s) => sanitizeSkillBody(s.body))
      .filter(Boolean)
      .join('\n\n---\n\n');

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

  // Addons the agent can review or change. Gated on the agent actually holding
  // an addon tool: an agent without one can neither read nor modify an addon,
  // so listing them would only burn context. Disabled addons are listed too —
  // an agent asked to fix a broken addon needs to see the one that is off.
  if (addons?.length && tools?.some((t) => t.name.startsWith('addon_'))) {
    const entries = addons
      .map((a) => {
        const version = a.version ? ` v${a.version}` : '';
        const state = a.status === 'enabled' ? '' : ` (${a.status})`;
        const description = a.description ? ` — ${a.description}` : '';
        return `- ${a.id}: ${a.name}${version}${state}${description}`;
      })
      .join('\n');

    prompt += `

[ADDONS_AVAILABLE]
The following addons are installed on this instance:
${entries}

Addons live in a directory managed by OpenAidy, OUTSIDE your workspace — no workspace_* or code_* tool can see or change them.
To inspect one before changing it, call addon_read({ addon_id: "<id>" }) for its file list, then addon_read({ addon_id: "<id>", paths: ["app/index.js"] }) for contents.
Never rewrite a file from memory: addon_update OVERWRITES whole files, so read first or you will silently drop code you did not author.
[/ADDONS_AVAILABLE]`;
  }

  // Inject tool guidelines with honest information about available tools and workspace permissions
  if (tools?.length) {
    prompt += buildToolGuidelinesBlock(tools, workspacePermissions);
  }
  // Inject permanent reminder about personality files (on every message when personality service is available)
  if (personalityService) {
    prompt += `\n\n[PERSONALITY_FILES_REMINDER]
## Personality Files
Your personality configuration is stored in workspace files:
- AGENT.md: Your agent identity (name, emoji, tone)
- USER.md: User profile (name, role, technical level)
- MISSION.md: The user's mission for this conversation
- RULES.md: Hard constraints or rules to always follow

When the user tells you something that should be saved to any of these files, ALWAYS use the workspace_write tool with the appropriate path and content format. Do NOT use memory_save for personality information.
[/PERSONALITY_FILES_REMINDER]`;
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

  // Check memory tools
  const hasMemorySave = availableTools.has('memory_save');
  const hasMemorySearch = availableTools.has('memory_search');
  const hasSessionsSearch = availableTools.has('sessions_search');

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

  // Memory tools guidance
  if (hasMemorySave || hasMemorySearch || hasSessionsSearch) {
    guidelines += `
### Memory Tools
`;
    if (hasMemorySave) {
      guidelines += `- memory_save: USE THIS when you learn facts, decisions, user preferences, or important information that should be remembered for future conversations
  - SAVE TO MEMORY when: user mentions a preference, you make a decision for the project, you learn something specific about the user's stack or goals, or you want to "bookmark" something for later
`;
    }
    if (hasMemorySearch) {
      guidelines += `- memory_search: USE THIS when you need to find previously saved information — searches your agent's memory by keywords
`;
    }
    if (hasSessionsSearch) {
      guidelines += `- sessions_search: USE THIS when you need to find information from past conversations — searches session titles AND message content
  - USE sessions_search when: user asks "do you remember...", "what did we talk about...", "continue with that topic...", or references something discussed in a previous session
  - INTERPRET THE RESULTS: Each result contains these fields:
${formatSessionSearchResultDocs()}
`;
    }
  }

  // Workspace capabilities section - CRITICAL for honesty
  guidelines += `
### Your Workspace Capabilities (BE EXPLICITLY HONEST ABOUT THESE)
`;
  if (hasWorkspaceRead) {
    guidelines += `- READ: You CAN read files from your workspace
`;
  } else {
    guidelines += `- READ: You CANNOT read files (workspace_read not enabled)
`;
  }

  if (hasWorkspaceWrite) {
    guidelines += `- WRITE: You CAN create and modify files in your workspace
`;
  } else {
    guidelines += `- WRITE: You CANNOT write files (workspace_write not enabled)
`;
  }

  if (hasWorkspaceList) {
    guidelines += `- LIST: You CAN list files in your workspace
`;
  } else {
    guidelines += `- LIST: You CANNOT list files (workspace_list not enabled)
`;
  }

  if (hasWorkspaceDelete) {
    guidelines += `- DELETE: You CAN delete files from your workspace
`;
  } else {
    guidelines += `- DELETE: You CANNOT delete files (workspace_delete not enabled)
`;
  }

  guidelines += `
## HONESTY REQUIREMENTS (VIOLATING THESE IS A BUG)

1. ONLY use tools marked [ENABLED] above. Do not pretend to have access to disabled tools.

2. If a user asks you to perform an action requiring a disabled tool:
   - NEVER pretend you did it
   - ALWAYS explain honestly: "I don't have access to [action]. My [tool_name] is not enabled."
   - SUGGEST alternatives if possible

3. BEFORE claiming you completed a task, VERIFY you actually used the tool successfully and got a success response.

4. If asked to write/save/create a file and you don't have workspace_write:
   Say EXPLICITLY: "I cannot write files because I don't have the workspace_write tool enabled."
   Do NOT say "I've written the file" or "I'll save it" if you can't actually do it.

5. Be UPFRONT about limitations immediately. Don't wait for the user to find out.
[/TOOL_GUIDELINES]`;

  return guidelines;
}
