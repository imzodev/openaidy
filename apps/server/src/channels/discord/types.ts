import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service.js';

/**
 * Dependencies required by the Discord channel implementation.
 * Mirrors the registry-level deps; `authBaseDir` is unused by Discord (the bot
 * token comes from config) but kept for parity with other channels.
 */
export type DiscordChannelDeps = {
  sessionService: SessionMessageService;
  authBaseDir: string;
  logger: FastifyBaseLogger;
};
