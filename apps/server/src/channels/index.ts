import type { FastifyBaseLogger } from 'fastify';
import type { ChannelConfig } from '@openaidy/config';
import type { SessionMessageService } from '../sessions/service';
import { ChannelRegistry } from './registry.js';
import type { IChannel } from './interface.js';
import { WhatsAppChannel } from './whatsapp/service.js';

export type ChannelRegistryDeps = {
  sessionService: SessionMessageService;
  authBaseDir: string;
  logger: FastifyBaseLogger;
};

// Re-export all public types
export { ChannelRegistry };
export type { IChannel } from './interface.js';

/**
 * Build a live channel instance from its config entry. The single place that
 * maps a channel `type` to its service class — both {@link createChannelRegistry}
 * and {@link reconcileChannelRegistry} go through here, so adding a new channel
 * type is a one-line change.
 *
 * To add a new channel type:
 *   1. Add its config schema to packages/config (discriminated union)
 *   2. Create its service class implementing IChannel
 *   3. Add an `if (cfg.type === 'newtype')` branch below
 *   Zero other files need to change.
 */
function createChannelInstance(
  cfg: ChannelConfig,
  deps: ChannelRegistryDeps,
): IChannel | null {
  if (cfg.type === 'whatsapp') {
    return new WhatsAppChannel(cfg, deps);
  }
  // Future channel types go here, e.g.:
  // if (cfg.type === 'telegram') {
  //   const { TelegramChannel } = await import('./telegram/service.js');
  //   return new TelegramChannel(cfg, deps);
  // }
  return null;
}

/**
 * Instantiates a ChannelRegistry from the channels config array.
 * Called once during app startup in app.ts.
 */
export function createChannelRegistry(
  configs: ChannelConfig[] | undefined,
  deps: ChannelRegistryDeps,
): ChannelRegistry {
  const registry = new ChannelRegistry();
  for (const cfg of configs ?? []) {
    const channel = createChannelInstance(cfg, deps);
    if (channel) registry.register(channel);
  }
  return registry;
}

/**
 * Reconcile the live registry against a (possibly changed) channels config —
 * the runtime counterpart to persisting `config.channels`. Registry instances
 * are built only once at startup, so without this a channel added or removed
 * via the UI/config PUT would not take effect until a restart.
 *
 * - A channel id newly present in config is registered (but NOT auto-connected;
 *   the user explicitly clicks Connect to start the QR pairing flow).
 * - A channel id no longer in config is disconnected and removed.
 * - An existing id is left untouched. Changing an already-registered channel's
 *   agentId/allowlist in place still requires a restart — a rare edit, and
 *   recreating a live instance would drop an active WhatsApp session.
 */
export async function reconcileChannelRegistry(
  registry: ChannelRegistry,
  configs: ChannelConfig[] | undefined,
  deps: ChannelRegistryDeps,
): Promise<void> {
  const desired = new Map((configs ?? []).map((cfg) => [cfg.id, cfg]));

  // Remove channels that are gone from config (disconnects them first).
  for (const channel of registry.getAll()) {
    if (!desired.has(channel.id)) {
      await registry.remove(channel.id);
    }
  }

  // Register channels newly added to config.
  for (const cfg of desired.values()) {
    if (registry.has(cfg.id)) continue;
    const channel = createChannelInstance(cfg, deps);
    if (channel) registry.register(channel);
  }
}
