import type { AgentPersonalityService } from '../agents/personality-service';
import type { SkillRegistry } from '../skills';
import { sanitizeSkillBody } from '../skills/sanitize.js';
import type { ProviderServices } from '../providers';
import { autoFillPersonalityFiles } from './auto-fill-personality.js';
import type { ToolDefinition } from '@openaidy/runtime';
import type { WorkspacePermissionsInfo } from '../types.js';
import type { SessionType } from '@openaidy/shared-types';
import { ALL_TOOL_METAS } from '../tools/catalog.js';
import { formatSessionSearchResultDocs } from '@openaidy/db';
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
  /** Session type - used to inject context-specific reminders */
  sessionType?: SessionType | undefined;
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
    // inject targeted onboarding instructions for each blank file.
    if (isFirstMessage) {
      const blankLabels = await personalityService.getBlankFileLabels(agentId);
      if (blankLabels.length > 0) {
        prompt += `\n\n[ONBOARDING]`;
        for (const label of blankLabels) {
          if (label === 'Agent Identity') {
            prompt += `\n\nYour Agent Identity profile is not configured. Before answering the user's message, ask them:
- What name and emoji should I use?
- What tone should I have? (e.g. "direct and concise", "warm and encouraging", "formal and precise")
Use \`present_choices\` to offer 3-4 example tones as selectable options.`;
          } else if (label === 'User Profile') {
            prompt += `\n\nThe User Profile is not configured. Before answering the user's message, ask them:
- What should I call them?
- What is their role or profession?
- How technical are they? (e.g. "senior engineer", "product designer", "non-technical founder")
Use \`present_choices\` to offer 3-4 example roles/technicality levels as selectable options.`;
          } else if (label === 'Mission') {
            prompt += `\n\nThe Mission Context is not configured. You need to understand the user's mission — what they want to accomplish in this conversation. Before answering the user's message, explicitly tell them: "I need to know your mission to help you effectively." Then ask: "What is your mission for this conversation?" Use \`present_choices\` to offer example missions such as:
- "Complete a task or project"
- "Learn or explore a topic"
- "Make a decision or get advice"
- "Brainstorm or generate ideas"
- "Solve a problem"
Or let them type their own mission.`;
          } else if (label === 'Rules') {
            prompt += `\n\nThe Rules are not configured. Before answering the user's message, ask if there are any hard constraints you must always follow (e.g. "always respond in Spanish", "never suggest paid tools", "always double-check my work"). Use \`present_choices\` to offer 3-4 example rule sets as selectable options.`;
          }
        }
        // Only add the "one at a time" instruction if there are multiple things to ask
        if (blankLabels.length > 1) {
          prompt += `\n\nImportant: Ask about ONE thing at a time. Use \`present_choices\` for each question to give concrete options rather than open-ended questions. Wait for the user's response before asking the next one.`;
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
