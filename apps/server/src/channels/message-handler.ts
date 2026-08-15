import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../sessions/service.js';
import { stripThinking as stripThinkingBlocks } from '../lib/message.js';

/**
 * Build a session key namespaced by channel type, channel id, and sender.
 * The type prefix keeps sessions from different channels (e.g. `whatsapp:` vs
 * `discord:`) from colliding in the shared session map / session titles.
 */
export function buildChannelSessionKey(
  channelType: string,
  channelId: string,
  senderId: string,
): string {
  return `${channelType}:${channelId}:${senderId}`;
}

/**
 * In-memory session key → sessionId map.
 * Survives across messages within a server process.
 * On server restart the map is rebuilt from existing sessions via listSessions().
 */
class SessionMap {
  private readonly map = new Map<string, string>();

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  set(key: string, sessionId: string): void {
    this.map.set(key, sessionId);
  }

  /** Reset all entries — for testing only */
  clear(): void {
    this.map.clear();
  }
}

// Singleton — shared across all channels' message handling within one process.
// Keys are namespaced by channel type (see buildChannelSessionKey), so sharing
// is safe across channels.
const sessionMap = new SessionMap();

/** Reset the session map — for testing only */
export function clearSessionMapForTesting(): void {
  sessionMap.clear();
}

/**
 * Find existing session ID by session title, or create a new session.
 * Results are cached in module-level sessionMap.
 */
async function findOrCreateSession(
  sessionKey: string,
  sessionService: Pick<SessionMessageService, 'listSessions' | 'createSession'>,
): Promise<string> {
  // Check in-memory cache first
  const cached = sessionMap.get(sessionKey);
  if (cached) return cached;

  // Try to find existing session by title (listSessions returns sessions with id + title)
  const sessions = await sessionService.listSessions();
  const sessionsArr = sessions as Array<{ id: string; title: string }>;
  const existing = sessionsArr.find((s) => s.title === sessionKey);

  if (existing) {
    sessionMap.set(sessionKey, existing.id);
    return existing.id;
  }

  // Create new session
  const created = await sessionService.createSession(sessionKey);
  const id = (created as { id: string }).id;
  sessionMap.set(sessionKey, id);
  return id;
}

/**
 * Handle an inbound message from any channel.
 *
 * Single responsibility: translate an inbound message into a session
 * interaction and return the text reply (or null if rejected/errored).
 * Channel-agnostic — no transport (Baileys, discord.js, …) imports — so it is
 * fully unit-testable in isolation and shared by every channel.
 */
export async function handleInboundChannelMessage(params: {
  /** Channel type, used for the session-key prefix and log context. */
  channelType: string;
  /** Stable id of the sender (session key + default allowlist candidate). */
  senderId: string;
  /**
   * Id forms the sender may be matched against in the allowlist. Defaults to
   * `[senderId]` when omitted (WhatsApp passes phone + LID forms).
   */
  candidateIds?: string[];
  text: string;
  channelId: string;
  agentId: string;
  allowlist: string[] | undefined;
  /**
   * Strip `<think>...</think>`-style reasoning blocks from the reply before
   * returning it. Defaults to `true` (see `stripThinkingSchema` in
   * `@openaidy/config`, whose default this mirrors for callers that omit it,
   * e.g. tests).
   */
  stripThinking?: boolean;
  sessionService: Pick<
    SessionMessageService,
    'listSessions' | 'createSession' | 'submitMessageNonStreaming'
  >;
  logger: FastifyBaseLogger;
}): Promise<string | null> {
  const {
    channelType,
    senderId,
    text,
    channelId,
    agentId,
    allowlist,
    stripThinking = true,
    sessionService,
    logger,
  } = params;
  const candidateIds = params.candidateIds?.length
    ? params.candidateIds
    : [senderId];
  logger.debug(
    {
      channelType,
      senderId,
      candidateIds,
      text,
      channelId,
      agentId,
      allowlist,
    },
    `${channelType}: message received`,
  );
  // 1. Allowlist gate. An empty/absent allowlist allows everyone — matching
  //    the channel UI ("leave empty to allow everyone"). A non-empty allowlist
  //    restricts to the listed ids, matched against any of the sender's id
  //    forms.
  if (allowlist?.length && !candidateIds.some((id) => allowlist.includes(id))) {
    // Logged at info (not debug) so an operator can see exactly which id
    // arrived and add it to the allowlist if a message is being dropped.
    logger.info(
      { channelType, senderId, candidateIds, channelId },
      `${channelType}: message rejected by allowlist`,
    );
    return null;
  }

  // 2. Build session key and find or create session
  const sessionKey = buildChannelSessionKey(channelType, channelId, senderId);
  const sessionId = await findOrCreateSession(sessionKey, sessionService);

  // 3. Submit message (non-streaming — channel needs full reply text)
  const result = await sessionService.submitMessageNonStreaming({
    sessionId,
    role: 'user',
    content: text,
    agentId,
  });

  if (!result.ok) {
    logger.error(
      { error: result.error, sessionId, channelId, channelType },
      `${channelType}: agent invocation failed`,
    );
    return null;
  }

  const reply = result.assistantMessage?.content ?? null;
  if (reply === null) return null;
  return stripThinking ? stripThinkingBlocks(reply) : reply;
}
