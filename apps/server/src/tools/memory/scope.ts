import type { MemoryToolDeps } from './index.js';

/**
 * The tool runs in a customer chat. A session with no chat route (the web
 * UI, tasks) is not one; a lookup failure counts as one, so an error never
 * exposes the owner's details.
 */
export async function inCustomerChat(
  deps: MemoryToolDeps,
  sessionId: string | undefined,
): Promise<boolean> {
  if (!sessionId || !deps.isCustomerSession) return false;
  try {
    return await deps.isCustomerSession(sessionId);
  } catch (err) {
    deps
      .createLogger('memory')
      .warn('Could not tell who a conversation is with', { sessionId, err });
    return true;
  }
}
