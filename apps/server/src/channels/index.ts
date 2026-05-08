import type { FastifyBaseLogger } from 'fastify';
import type { ChannelConfig } from '@openaidy/config';
import type { SessionMessageService } from '../sessions/service.js';
import { ChannelRegistry } from './registry.js';

export type ChannelRegistryDeps = {
  sessionService: SessionMessageService;
  authBaseDir: string;
  logger: FastifyBaseLogger;
};

// Re-export all public types
export { ChannelRegistry };
export type { IChannel } from './interface.js';

/**
 * Instantiates a ChannelRegistry from the channels config array.
 * Called once during app startup in app.ts.
 *
 * To add a new channel type:
 *   1. Add its config schema to packages/config (discriminated union)
 *   2. Create its service class implementing IChannel
 *   3. Add an `if (cfg.type === 'newtype')` branch below
 *   Zero other files need to change.
 */
export function createChannelRegistry(
  configs: ChannelConfig[] | undefined,
  deps: ChannelRegistryDeps,
): ChannelRegistry {
  const registry = new ChannelRegistry();
  for (const cfg of configs ?? []) {
    if (cfg.type === 'whatsapp') {
      // TODO: import and instantiate WhatsAppChannel once Phase 4 is merged
      // const { WhatsAppChannel } = await import('./whatsapp/service.js');
      // registry.register(new WhatsAppChannel(cfg, deps));
      deps.logger.info(
        { channelId: cfg.id },
        'whatsapp channel configured (pending Phase 4)',
      );
    }
    // Future channel types go here, e.g.:
    // if (cfg.type === 'telegram') {
    //   const { TelegramChannel } = await import('./telegram/service.js');
    //   registry.register(new TelegramChannel(cfg, deps));
    // }
  }
  return registry;
}
