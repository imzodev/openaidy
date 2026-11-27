import { z } from 'zod';
import {
  MEMORY_KIND_VALUES,
  OWNER_MEMORY_AGENT_ID,
  type CompactionSourceMessage,
  type LearnedMemoryOp,
  type Memory,
  type MemoryLearningOutcome,
} from '@aidyagent/shared-types';
import type { MemoriesStore } from '@aidyagent/db';
import { isCompactionSummary } from '../sessions/compaction.js';

/** Most changes one pass may make, so a bad answer can't rewrite the profile. */
export const MAX_OPS_PER_PASS = 5;

/** Known facts shown to the extractor so it updates instead of duplicating. */
export const MAX_EXISTING_FACTS = 80;

export const LEARNING_INSTRUCTIONS = `You maintain what an AI assistant knows about its owner — the person it works for. You read a new part of a conversation between the owner and the assistant and decide whether it taught anything worth remembering for future conversations.

Remember only durable things the owner said or made clear:
- preference: how they like things done (tone, length, language, formats, tools, times).
- person: people in their life or business and their role ("Ana is my business partner").
- routine: recurring habits and schedules ("closes the books every Friday").
- goal: ongoing aims or projects that will matter beyond today.
- fact: other lasting facts about them or their business (location, line of work, accounts they use).

Never remember:
- details of the task at hand that won't matter next time;
- anything about the business's customers or other third parties beyond who they are to the owner;
- secrets: passwords, card or bank numbers, API keys, one-time codes, IDs of documents;
- guesses. If the owner didn't say it or make it obvious, leave it out.

Compare with what is already known (listed with ids). If something known changed or was refined, update it rather than adding a duplicate. If the owner said a known item is no longer true, forget it. Usually a conversation teaches nothing new: that is fine.

Write titles and content in the owner's language, as short third-person statements ("Prefers short answers"). Importance is 1–5: 5 for things that should shape almost every answer, 3 by default, 1 for minor details.

Answer with JSON only, no other text:
{"ops":[{"op":"add","kind":"preference","title":"…","content":"…","importance":3},{"op":"update","id":"<known id>","content":"…","importance":4},{"op":"forget","id":"<known id>"}]}
Answer {"ops":[]} when there is nothing to learn. At most ${MAX_OPS_PER_PASS} ops.`;

const importanceSchema = z.number().int().min(1).max(5);
const textSchema = z.string().trim().min(1).max(500);

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    kind: z.enum(MEMORY_KIND_VALUES),
    title: z.string().trim().min(1).max(120),
    content: textSchema,
    importance: importanceSchema.default(3),
  }),
  z.object({
    op: z.literal('update'),
    id: z.string().min(1),
    content: textSchema,
    importance: importanceSchema.optional(),
  }),
  z.object({ op: z.literal('forget'), id: z.string().min(1) }),
]);

/**
 * The messages after `throughSequence` that the owner actually took part
 * in. Turns someone else started (a pulse or reminder prompt, or work
 * another agent handed over) are dropped with the agent's work on them,
 * as are compaction summaries.
 */
export function selectLearnableMessages<T extends CompactionSourceMessage>(
  messages: readonly T[],
  throughSequence: number,
): T[] {
  const kept: T[] = [];
  let inForeignTurn = false;
  for (const m of messages) {
    if (m.sequence <= throughSequence || isCompactionSummary(m)) continue;
    if (m.role === 'user') {
      inForeignTurn = m.metadata?.['origin'] !== undefined;
    }
    if (!inForeignTurn) kept.push(m);
  }
  return kept;
}

/** The user message for the extractor: what's known, then what's new. */
export function buildLearningRequest(
  known: readonly Memory[],
  transcript: string,
): string {
  const knownLines = known.length
    ? known
        .map(
          (m) =>
            `- id=${m.id} [${m.kind ?? 'fact'}, importance ${m.importance}] ${m.title}: ${m.content}`,
        )
        .join('\n')
    : '(nothing yet)';
  return `Already known about the owner:\n${knownLines}\n\nNew part of the conversation:\n${transcript}`;
}

/**
 * The valid ops in the extractor's answer. Tolerates code fences and text
 * around the JSON; invalid ops are dropped one by one rather than failing
 * the whole answer. Returns null when no JSON object can be found at all.
 */
export function parseLearningOps(text: string): LearnedMemoryOp[] | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (_err) {
    return null;
  }
  const rawOps = (parsed as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(rawOps)) return null;

  const ops: LearnedMemoryOp[] = [];
  for (const raw of rawOps) {
    const result = opSchema.safeParse(raw);
    if (!result.success) continue;
    const op = result.data;
    if (op.op === 'update') {
      ops.push({
        op: 'update',
        id: op.id,
        content: op.content,
        ...(op.importance !== undefined ? { importance: op.importance } : {}),
      });
    } else {
      ops.push(op);
    }
    if (ops.length >= MAX_OPS_PER_PASS) break;
  }
  return ops;
}

/**
 * Apply ops to the owner's memories. Updates and forgets only touch ids
 * the extractor was shown (so it can't reach another agent's memories),
 * and forget only removes facts that were learned — something the owner
 * or an agent wrote on purpose is never deleted by a guess.
 */
export async function applyLearningOps(params: {
  ops: readonly LearnedMemoryOp[];
  known: readonly Memory[];
  memories: MemoriesStore;
  sessionId: string;
}): Promise<MemoryLearningOutcome> {
  const knownById = new Map(params.known.map((m) => [m.id, m]));
  const outcome: MemoryLearningOutcome = { added: 0, updated: 0, forgotten: 0 };

  for (const op of params.ops) {
    if (op.op === 'add') {
      await params.memories.create({
        agentId: OWNER_MEMORY_AGENT_ID,
        title: op.title,
        content: op.content,
        importance: op.importance,
        kind: op.kind,
        source: 'learned',
        sourceSessionId: params.sessionId,
      });
      outcome.added++;
      continue;
    }
    const target = knownById.get(op.id);
    if (!target) continue;
    if (op.op === 'update') {
      const updated = await params.memories.update(
        op.id,
        {
          content: op.content,
          ...(op.importance !== undefined ? { importance: op.importance } : {}),
        },
        OWNER_MEMORY_AGENT_ID,
      );
      if (updated) outcome.updated++;
    } else if (target.source === 'learned') {
      if (await params.memories.delete(op.id, OWNER_MEMORY_AGENT_ID)) {
        outcome.forgotten++;
      }
    }
  }
  return outcome;
}
