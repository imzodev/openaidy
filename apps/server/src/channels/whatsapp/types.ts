import type { FastifyBaseLogger } from 'fastify';
import type { SessionMessageService } from '../../sessions/service.js';

/**
 * Dependencies required by the WhatsApp channel implementation.
 * All scoped to the whatsapp module — not exported from shared-types.
 */
export type WhatsAppChannelDeps = {
  sessionService: SessionMessageService;
  authBaseDir: string;
  logger: FastifyBaseLogger;
};
