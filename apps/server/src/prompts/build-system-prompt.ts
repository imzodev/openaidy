import type { AgentPersonalityService } from '../agents/personality-service';
import type { SkillRegistry } from '../skills';
import { sanitizeSkillBody } from '../skills/sanitize.js';
import type { ProviderServices } from '../providers';
import { autoFillPersonalityFiles } from './auto-fill-personality.js';
import type { ToolDefinition } from '@openaidy/runtime';
import type { WorkspacePermissionsInfo } from '../types.js';
import { ALL_TOOL_METAS } from '../tools/catalog.js';

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
};

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
    if (bodies) {
      prompt += '\n\n[SKILL_CONTEXTS]\n' + bodies + '\n[/SKILL_CONTEXTS]';
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
  - INTERPRET THE RESULTS: A session may appear because the title matches OR because message content matched. Check the matchType field:
    - "title": Session title matched the query
    - "content": Message content matched (more relevant for finding actual discussion)
    - matchCount: How many messages matched — higher = more relevant
    - snippet: Shows a preview of matching content — use this to understand why the session was found
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
