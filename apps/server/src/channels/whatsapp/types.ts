import type { FastifyBaseLogger } from 'fastify';
import type { ChannelWorkflowTriggers } from '../message-handler.js';
import type { SessionMessageService } from '../../sessions/service.js';

/**
 * Dependencies required by the WhatsApp channel implementation.
 * All scoped to the whatsapp module — not exported from shared-types.
 */
export type WhatsAppChannelDeps = {
  sessionService: SessionMessageService;
  authBaseDir: string;
  logger: FastifyBaseLogger;
  /** Workflow triggers checked before a message goes to the agent. */
  getWorkflowTriggers?: () => ChannelWorkflowTriggers | undefined;
};
