/**
 * Addon Proxy Agent Service
 *
 * Encapsulates session management and agent invocation on behalf of addons.
 * Part of the proxy layer — keeps route handlers thin by owning the session
 * cache, session creation, and message submission lifecycle.
 */

import type { SessionMessageService } from '../sessions/service';
import type { AddonAgentInvokeResult } from './types';

export class AddonProxyAgentService {
  // Cache session IDs per addon+agent pair so we reuse sessions instead of leaking new ones.
  // TODO: Add a SessionMessageService.findSessionByTitle() method so we
  // can recover sessions across server restarts instead of relying on
  // an in-memory cache.
  private readonly sessionCache = new Map<string, string>();

  constructor(private readonly sessionService: SessionMessageService) {}

  /**
   * Invoke an agent on behalf of an addon.
   *
   * Reuses an existing session for the addon+agent pair, or creates one.
   * Returns the assistant's response content.
   */
  async invoke(
    addonId: string,
    agentId: string,
    input: string,
  ): Promise<AddonAgentInvokeResult> {
    const cacheKey = `${addonId}:${agentId}`;
    let sessionId = this.sessionCache.get(cacheKey);

    if (!sessionId) {
      const session = await this.sessionService.createSession(
        `addon:${addonId}:${agentId}`,
      );
      sessionId = session.id;
      this.sessionCache.set(cacheKey, sessionId);
    }

    const result = await this.sessionService.submitMessageStreaming({
      sessionId,
      role: 'user',
      content: input,
      agentId,
      onStreamEvent: () => {},
    });

    if (!result.ok) {
      return {
        ok: false,
        error: { code: result.error.code, message: result.error.message },
      };
    }

    return {
      ok: true,
      agentId,
      sessionId,
      message: result.assistantMessage.content,
    };
  }
}
