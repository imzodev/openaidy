/**
 * Addon Proxy Agent Service
 *
 * Encapsulates session management and agent invocation on behalf of addons.
 * Part of the proxy layer — keeps route handlers thin by owning the session
 * cache and delegating dispatch logic to SessionMessageService.dispatchAgent().
 *
 * Session cache per addon+agent pair avoids leaking new sessions on every call.
 * TODO: Add a SessionMessageService.findSessionByTitle() method so we
 * can recover sessions across server restarts instead of relying on
 * an in-memory cache.
 */

import type { SessionMessageService } from '../sessions/service';
import type { AddonAgentInvokeResult } from './types';

export class AddonProxyAgentService {
  private readonly sessionCache = new Map<string, string>();

  constructor(private readonly sessionService: SessionMessageService) {}

  /**
   * Invoke an agent on behalf of an addon.
   *
   * Reuses an existing session for the addon+agent pair, or creates one.
   * Delegates all dispatch logic to SessionMessageService.dispatchAgent() —
   * the single shared entry point also used by agent tools.
   * Returns the assistant's response content synchronously (awaits completion).
   */
  async invoke(
    addonId: string,
    agentId: string,
    input: string,
  ): Promise<AddonAgentInvokeResult> {
    const cacheKey = `${addonId}:${agentId}`;
    const cachedSessionId = this.sessionCache.get(cacheKey);

    const dispatchResult = await this.sessionService.dispatchAgent({
      agentId,
      content: input,
      ...(cachedSessionId ? { sessionId: cachedSessionId } : {}),
      sessionTitle: `addon:${addonId}:${agentId}`,
    });

    if (!dispatchResult.ok) {
      return {
        ok: false,
        error: { code: 'dispatch.failed', message: dispatchResult.error },
      };
    }

    const { sessionId, done } = dispatchResult;

    // Cache sessionId for future calls from the same addon+agent pair
    if (!cachedSessionId) {
      this.sessionCache.set(cacheKey, sessionId);
    }

    // Wait for the agent to finish (synchronous for addon UX)
    const result = await done;

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
