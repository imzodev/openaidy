import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service.js';

/**
 * Build a session key for a WhatsApp contact.
 */
function buildSessionKey(channelId: string, waId: string): string {
  return `whatsapp:${channelId}:${waId}`;
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

// Singleton — shared across all message handling within one process
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
  sessionService: SessionMessageService,
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
 * Handle an inbound WhatsApp message.
 *
 * Single responsibility: translate an inbound message into a session interaction
 * and return the text reply (or null if rejected/errored).
 *
 * Zero Baileys imports — fully unit-testable in isolation.
 */
export async function handleInboundWhatsAppMessage(params: {
  waId: string;
  text: string;
  channelId: string;
  agentId: string;
  allowlist: string[] | undefined;
  sessionService: Pick<SessionMessageService, 'listSessions' | 'createSession' | 'submitMessageNonStreaming'>;
  logger: FastifyBaseLogger;
}): Promise<string | null> {
  const { waId, text, channelId, agentId, allowlist, sessionService, logger } =
    params;
  logger.debug({ waId, text, channelId, agentId, allowlist }, 'whatsapp: message received');
  // 1. Allowlist check (empty or missing = reject all)
  if (!allowlist?.length || !allowlist.includes(waId)) {
    logger.debug(
      { waId, channelId },
      'whatsapp: message rejected by allowlist',
    );
    return null;
  }

  // 2. Build session key and find or create session
  const sessionKey = buildSessionKey(channelId, waId);
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
      { error: result.error, sessionId, channelId },
      'whatsapp: agent invocation failed',
    );
    return null;
  }

  return result.assistantMessage?.content ?? null;
}
