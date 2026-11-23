import {
  COMPACTION_SUMMARY_KIND,
  type CompactionSourceMessage,
} from '@aidyagent/shared-types';

/** Recent user turns (and everything after them) always kept verbatim. */
export const COMPACTION_KEEP_USER_TURNS = 4;

/** Compact once replayed history passes this share of the context budget. */
export const COMPACTION_TRIGGER_FRACTION = 0.7;

const TOOL_RESULT_EXCERPT_CHARS = 1_500;

export const COMPACTION_INSTRUCTIONS = `You compress the earlier part of a conversation between a user and an AI agent so the agent can continue without the full transcript.

Write a concise summary in the conversation's language with these sections (skip a section if empty):
- Goals: what the user is trying to achieve overall.
- Facts about the user: preferences, constraints, names, accounts.
- Decisions and results: what was decided or done, with concrete IDs, URLs, file paths, numbers.
- Open threads: unanswered questions, unfinished tasks, promised follow-ups, and the state of any task in progress.

Keep every concrete identifier the agent may need later. Leave out greetings, chit-chat and tool output that no longer matters. Write only the summary.`;

export function isCompactionSummary(message: CompactionSourceMessage): boolean {
  return message.metadata?.['kind'] === COMPACTION_SUMMARY_KIND;
}

/**
 * Drop the messages the latest summary already covers. Returns the
 * remaining messages (summary rows removed) and that summary's text.
 */
export function applyLatestSummary<T extends CompactionSourceMessage>(
  messages: readonly T[],
): { messages: T[]; summary: string | undefined } {
  let latest: T | undefined;
  for (const m of messages) {
    if (isCompactionSummary(m)) latest = m;
  }
  if (!latest) return { messages: [...messages], summary: undefined };
  const covers = latest.metadata?.['coversThroughSequence'];
  const coveredThrough = typeof covers === 'number' ? covers : -1;
  return {
    messages: messages.filter(
      (m) => !isCompactionSummary(m) && m.sequence > coveredThrough,
    ),
    summary: latest.content,
  };
}

/**
 * Index of the first message to keep verbatim: the start of the Nth-from-last
 * user turn. Cutting at a user message never separates a tool call from its
 * result. Returns 0 when there is not enough history to compact.
 */
export function findCompactionCut(
  messages: readonly CompactionSourceMessage[],
  keepUserTurns = COMPACTION_KEEP_USER_TURNS,
): number {
  const userIndexes: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') userIndexes.push(i);
  });
  if (userIndexes.length <= keepUserTurns) return 0;
  return userIndexes[userIndexes.length - keepUserTurns] ?? 0;
}

/**
 * Plain-text transcript of messages for the summarizer. Tool results are
 * excerpted; when the whole thing is over `maxChars`, the oldest part is
 * dropped since the previous summary (if any) already covers its gist.
 */
export function renderTranscript(
  messages: readonly CompactionSourceMessage[],
  maxChars: number,
): string {
  const lines = messages.map((m) => {
    if (m.role === 'tool') {
      const name = m.metadata?.['toolName'];
      const body =
        m.content.length > TOOL_RESULT_EXCERPT_CHARS
          ? `${m.content.slice(0, TOOL_RESULT_EXCERPT_CHARS)}… [${m.content.length} chars]`
          : m.content;
      return `[tool result${typeof name === 'string' ? ` from ${name}` : ''}]: ${body}`;
    }
    const calls = m.metadata?.['toolCalls'];
    const callNote = Array.isArray(calls)
      ? calls
          .map((c: unknown) => {
            const call = c as { name?: unknown; arguments?: unknown };
            const args =
              typeof call.arguments === 'string'
                ? call.arguments
                : JSON.stringify(call.arguments ?? {});
            return `\n  → called ${String(call.name)}(${args.slice(0, 300)})`;
          })
          .join('')
      : '';
    return `[${m.role}]: ${m.content}${callNote}`;
  });
  const transcript = lines.join('\n\n');
  if (transcript.length <= maxChars) return transcript;
  return `[…earlier part omitted…]\n\n${transcript.slice(transcript.length - maxChars)}`;
}

/** The user message sent to the summarizer. */
export function buildSummaryRequest(
  previousSummary: string | undefined,
  transcript: string,
): string {
  const previous = previousSummary
    ? `Summary of the conversation before this part:\n${previousSummary}\n\n`
    : '';
  return `${previous}Conversation to summarize:\n${transcript}`;
}

/** System-prompt block that carries the summary into later runs. */
export function buildSummaryBlock(summary: string): string {
  return `\n\n[CONVERSATION_SUMMARY]\nEarlier turns of this conversation were condensed to save context. This is what happened before the messages below:\n${summary}\n[/CONVERSATION_SUMMARY]`;
}
