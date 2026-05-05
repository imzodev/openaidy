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
        prompt += `\n\n[ONBOARDING]
The following personality context has not been configured yet: ${blankLabels.join(', ')}.

Before answering the user's message, greet them warmly and run through the missing onboarding questions — one at a time, starting with the most important. For each question, use the present_choices tool to present clear, selectable options. The user can pick one or type their own answer.

Use these questions and choices in order for whichever files are blank:

- Agent Identity: call present_choices with question "What tone should I use?" and choices like ["Direct and concise 🎯", "Warm and encouraging 🌱", "Formal and precise 📋", "Playful and creative 🎨"]. Then ask for a name with choices like ["Keep it simple — just 'Assistant'", "Give me a name like Nova, Scout, or Sage", "Let me type my own"].
- User Profile: call present_choices with question "How should I think of you?" and choices like ["Software engineer 💻", "Product designer 🎨", "Founder / non-technical 🚀", "Student or learner 📚"].
- Mission: call present_choices with question "What are we mainly working on?" and choices like ["A software project", "Content or writing", "Research or learning", "Business or strategy"].
- Rules: call present_choices with question "Any hard rules I should always follow?" and choices like ["Always be concise", "Never suggest paid tools", "Always respond in English", "No strict rules — use your judgment"].

After each answer, acknowledge it briefly and move to the next question. Do not ask everything at once.
[/ONBOARDING]`;
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
