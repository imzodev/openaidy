/**
 * How hard a model thinks before answering.
 *
 * A chat or agent picks a generic level; each provider adapter translates it
 * to its own parameter. No level (undefined) means "Auto": nothing is sent
 * and the model uses its own default.
 */

export const REASONING_EFFORT_VALUES = [
  'off',
  'low',
  'medium',
  'high',
  'max',
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];

/** Which wire parameter a model family takes. */
export type ReasoningStyle =
  | 'openai' // reasoning_effort
  | 'deepseek' // thinking.type + reasoning_effort
  | 'gemini-budget' // generationConfig.thinkingConfig.thinkingBudget (2.5)
  | 'gemini-level' // generationConfig.thinkingConfig.thinkingLevel (3.x)
  | 'anthropic-effort'; // output_config.effort

/** What a model accepts. */
export type ReasoningSupport = {
  style: ReasoningStyle;
  /** Levels the model accepts, lowest first. */
  levels: readonly ReasoningEffort[];
};

/** One row of the capability table. */
export type ReasoningModelRule = {
  match: RegExp;
} & ReasoningSupport;

/**
 * Models whose thinking control is documented. First match wins. A model
 * not listed gets no picker and nothing is sent, so an unknown model can
 * never be broken by a parameter it rejects.
 */
export const REASONING_MODEL_RULES: readonly ReasoningModelRule[] = [
  {
    match: /^deepseek-(v4|reasoner)/,
    style: 'deepseek',
    levels: ['off', 'low', 'high', 'max'],
  },
  {
    match: /^o[134](-|$)/,
    style: 'openai',
    levels: ['low', 'medium', 'high'],
  },
  {
    match: /^gemini-2\.5-flash/,
    style: 'gemini-budget',
    levels: ['off', 'low', 'medium', 'high'],
  },
  {
    match: /^gemini-2\.5-pro/,
    style: 'gemini-budget',
    levels: ['low', 'medium', 'high'],
  },
  { match: /^gemini-3/, style: 'gemini-level', levels: ['low', 'high'] },
  {
    // Claude 4.6+ and 5.x take output_config.effort; Haiku 4.5 and older
    // reject it.
    match: /^claude-((opus|sonnet)-4-[6-9]|(opus|sonnet|haiku|fable|mythos)-5)/,
    style: 'anthropic-effort',
    levels: ['low', 'medium', 'high', 'max'],
  },
];

/**
 * The thinking control a model accepts, or null when it has none known.
 * Accepts "providerId/modelId" or a bare model id.
 */
export function resolveReasoningSupport(
  model: string | undefined,
): ReasoningSupport | null {
  if (!model) return null;
  const id = (model.includes('/') ? model.slice(model.indexOf('/') + 1) : model)
    .trim()
    .toLowerCase();
  const rule = REASONING_MODEL_RULES.find((r) => r.match.test(id));
  return rule ? { style: rule.style, levels: rule.levels } : null;
}

/**
 * The supported level closest to `effort` (ties go to the higher one), or
 * undefined when there is no effort or no support. Lets an agent's default
 * keep working after its model changes.
 */
export function clampReasoningEffort(
  support: ReasoningSupport | null,
  effort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!support || !effort || support.levels.length === 0) return undefined;
  if (support.levels.includes(effort)) return effort;
  const rank = (e: ReasoningEffort) => REASONING_EFFORT_VALUES.indexOf(e);
  const target = rank(effort);
  let best: ReasoningEffort | undefined;
  let bestDistance = Infinity;
  for (const level of support.levels) {
    const distance = Math.abs(rank(level) - target);
    if (
      distance < bestDistance ||
      (distance === bestDistance && best && rank(level) > rank(best))
    ) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

/** Display names for the thinking levels. */
export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
};

/** Props of the chat composer's thinking picker (apps/web). */
export type ThinkingPickerProps = {
  /** Levels the current model accepts, lowest first. */
  levels: readonly ReasoningEffort[];
  /** This conversation's choice; undefined = Auto (agent default). */
  value: ReasoningEffort | undefined;
  /** The agent's default, shown on the Auto option. */
  agentDefault?: ReasoningEffort | undefined;
  onChange: (value: ReasoningEffort | undefined) => void;
  disabled?: boolean;
  /** 'inline' (desktop, labelled) or 'icon' (mobile, icon + bottom sheet). */
  variant?: 'inline' | 'icon';
};
