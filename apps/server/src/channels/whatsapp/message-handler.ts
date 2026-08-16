import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service.js';
import { handleInboundChannelMessage } from '../message-handler.js';

// Re-export so existing WhatsApp callers/tests keep importing from here.
export { clearSessionMapForTesting } from '../message-handler.js';

/**
 * Handle an inbound WhatsApp message.
 *
 * Thin adapter over the channel-agnostic {@link handleInboundChannelMessage}:
 * maps WhatsApp's `waId` to the generic `senderId` and pins the channel type
 * to `whatsapp` (so session keys stay `whatsapp:<channelId>:<waId>`, unchanged
 * from before the shared handler was extracted).
 *
 * Zero Baileys imports — fully unit-testable in isolation.
 */
export async function handleInboundWhatsAppMessage(params: {
  waId: string;
  /**
   * All id forms the sender may be matched against in the allowlist (phone
   * number and/or LID). Defaults to `[waId]` when omitted.
   */
  candidateIds?: string[];
  text: string;
  channelId: string;
  agentId: string;
  allowlist: string[] | undefined;
  /** See {@link handleInboundChannelMessage}'s `stripThinking` param. */
  stripThinking?: boolean;
  sessionService: Pick<
    SessionMessageService,
    'listSessions' | 'createSession' | 'submitMessageNonStreaming'
  >;
  logger: FastifyBaseLogger;
}): Promise<string | null> {
  return handleInboundChannelMessage({
    channelType: 'whatsapp',
    senderId: params.waId,
    ...(params.candidateIds ? { candidateIds: params.candidateIds } : {}),
    text: params.text,
    channelId: params.channelId,
    agentId: params.agentId,
    allowlist: params.allowlist,
    // Can't assign `stripThinking: params.stripThinking` directly: with
    // `exactOptionalPropertyTypes`, an explicit `undefined` is a different
    // type than an omitted key, so the conditional spread is load-bearing,
    // not redundant with `handleInboundChannelMessage`'s own default.
    ...(params.stripThinking !== undefined
      ? { stripThinking: params.stripThinking }
      : {}),
    sessionService: params.sessionService,
    logger: params.logger,
  });
}
