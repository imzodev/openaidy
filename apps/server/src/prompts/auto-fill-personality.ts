import type { AgentPersonalityService } from '../agents/personality-service';
import {
  PERSONALITY_FILES,
  isDefaultContent,
} from '../agents/personality-service';
import type { ProviderServices } from '../providers';
import type { PersonalityFileId } from '@openaidy/shared-types';

const FILL_PROMPTS: Record<
  PersonalityFileId,
  (agentSystemPrompt: string, userFirstMessage: string) => string
> = {
  AGENT: (agentSystemPrompt, userFirstMessage) =>
    `You are helping configure an AI agent's personality file.

Based on the agent's system prompt and the user's first message, write a concise AGENT.md file.
It should define the agent's name, emoji, tone, and character traits.
Write only the markdown content — no explanations, no code blocks.

Agent system prompt:
${agentSystemPrompt}

User's first message:
${userFirstMessage}

Write the AGENT.md content now:`,

  USER: (_agentSystemPrompt, userFirstMessage) =>
    `You are helping configure an AI agent's user profile file.

Based on the user's first message, infer who they are and write a concise USER.md file.
It should capture their name (if mentioned), role, expertise, and communication preferences.
If you cannot infer something, leave that section with a short placeholder in brackets like [unknown].
Write only the markdown content — no explanations, no code blocks.

User's first message:
${userFirstMessage}

Write the USER.md content now:`,

  MISSION: (_agentSystemPrompt, userFirstMessage) =>
    `You are helping configure an AI agent's mission file.

Based on the user's first message, infer the project or goal and write a concise MISSION.md file.
It should capture what they are working on, the tech stack if mentioned, and the current focus.
If you cannot infer something, leave that section with a short placeholder in brackets like [unknown].
Write only the markdown content — no explanations, no code blocks.

User's first message:
${userFirstMessage}

Write the MISSION.md content now:`,

  RULES: (agentSystemPrompt, _userFirstMessage) =>
    `You are helping configure an AI agent's rules file.

Based on the agent's system prompt, extract any hard constraints or behavioral rules and write a concise RULES.md file.
If no specific rules are implied, write a minimal set of sensible defaults.
Write only the markdown content — no explanations, no code blocks.

Agent system prompt:
${agentSystemPrompt}

Write the RULES.md content now:`,
};

/**
 * Auto-fill any personality files that still contain only the default template.
 * Calls the LLM once per blank file to generate appropriate content,
 * then writes the result back to disk.
 *
 * This is a best-effort operation — errors are silently ignored so they
 * never block the actual user message from being processed.
 */
export async function autoFillPersonalityFiles(options: {
  agentId: string;
  agentSystemPrompt: string;
  userFirstMessage: string;
  personalityService: AgentPersonalityService;
  providers: ProviderServices;
}): Promise<void> {
  const {
    agentId,
    agentSystemPrompt,
    userFirstMessage,
    personalityService,
    providers,
  } = options;

  for (const meta of PERSONALITY_FILES) {
    try {
      const file = await personalityService.readFile(agentId, meta.id);
      if (!isDefaultContent(file.content)) continue;

      const userPrompt = FILL_PROMPTS[meta.id](
        agentSystemPrompt,
        userFirstMessage,
      );

      const result = await providers.invocation.invoke({
        model: '',
        messages: [{ role: 'user', content: userPrompt }],
      });

      if (!result.ok) continue;

      const generated = result.value.content?.trim();
      if (generated) {
        await personalityService.writeFile(agentId, meta.id, generated);
      }
    } catch {
      // Best-effort: never block the conversation on a fill failure
    }
  }
}
