import type { AgentPersonalityService } from '../agents/personality-service';
import type { SkillRegistry } from '../skills';
import { sanitizeSkillBody } from '../skills/sanitize.js';
import type { ProviderServices } from '../providers';
import { autoFillPersonalityFiles } from './auto-fill-personality.js';

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
        prompt += `\n\n[ONBOARDING]\nSome context about you and the user has not been configured yet: ${blankLabels.join(', ')}. Before answering the user's message, greet them warmly, then ask them specific onboarding questions to fill in what is missing — one thing at a time, starting with the most important. Be concrete and give 2-3 short examples per question so the user knows what kind of answer to give. For Agent Identity: ask what name and emoji they would like, and what tone (e.g. "direct and concise", "warm and encouraging", "formal and precise"). For User Profile: ask their name, role, and how technical they are (e.g. "senior engineer", "product designer", "non-technical founder"). For Mission: ask what project or goal they are working on and the main technology or tools involved. For Rules: ask if there are any hard constraints the agent must always follow (e.g. "always respond in Spanish", "never suggest paid tools").\n[/ONBOARDING]`;
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

  return prompt;
}
