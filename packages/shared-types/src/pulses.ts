/**
 * Types that belong in packages/shared-types/src/:
 *   - Types used across two or more packages (CLI, server, web, SDK, etc.)
 *   - API request/response contracts shared between server and clients
 *   - Domain types that are not internal to a single package
 *
 * Types that do NOT belong here:
 *   - Server-only internal types → apps/server/src/types.ts
 *   - CLI-only internal types    → packages/cli/src/types.ts
 *   - Web-only UI types          → apps/web/src/lib/types.ts (pending refactor)
 */

/**
 * Schedule input types - discriminated union for different scheduling options.
 * Used by CreatePulseInput, UpdatePulseInput, and directly in tool parameters.
 */
export type ScheduleInput =
  | { every: '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' }
  | { daily: { hour: number; minute: number } }
  | { cron: string; tz?: string }
  | { at: string };

/**
 * Result of parsing a ScheduleInput into cron / one-shot form.
 */
export type ParsedSchedule = {
  type: 'cron' | 'one-shot';
  cronExpression?: string;
  schedule?: Date;
  nextRunAt: Date;
};

/**
 * Pulse status values.
 */
export type PulseStatus = 'active' | 'paused' | 'completed' | 'failed';

/**
 * Input for creating a new pulse.
 */
/**
 * What a scheduled prompt is: a pulse the user set up, a reminder an agent
 * scheduled from a conversation, or the owner's daily briefing.
 */
export type PulseKind = 'pulse' | 'reminder' | 'briefing';

/** Where a pulse's answer goes, besides its session. */
export type PulseDelivery = {
  /** Send the answer to the owner (WhatsApp etc., see `owner` config). */
  toOwner?: boolean;
  /** Only deliver when there's something to say (the agent can answer
   * NO_UPDATE to stay quiet). */
  onlyIfNeeded?: boolean;
};

export type CreatePulseInput = {
  name: string;
  prompt: string;
  schedule: ScheduleInput;
  agentId?: string;
  sessionId?: string;
  delivery?: PulseDelivery;
  /** Defaults to 'pulse'. */
  kind?: PulseKind;
};

/**
 * Input for updating an existing pulse.
 */
export type UpdatePulseInput = {
  name?: string;
  prompt?: string;
  schedule?: ScheduleInput;
  status?: 'active' | 'paused';
  agentId?: string | undefined;
  sessionId?: string | undefined;
  delivery?: PulseDelivery | undefined;
};

/**
 * Filters for listing pulses.
 */
export type ListPulsesFilters = {
  status?: PulseStatus;
  limit: number;
  offset: number;
};

/**
 * A pulse as returned by the API (e.g. GET /api/pulses, POST /api/pulses response).
 */
export type PulseRecord = {
  id: string;
  name: string;
  prompt: string;
  schedule: { cron?: string } | { at: string };
  scheduleHuman: string;
  status: PulseStatus;
  agentId?: string;
  sessionId?: string;
  lastRunAt?: Date;
  nextRunAt: Date;
  createdAt: Date;
  kind: PulseKind;
  delivery?: PulseDelivery;
};

/**
 * Paginated list response for pulses.
 */
export type PaginatedPulses = {
  pulses: PulseRecord[];
  total: number;
  limit: number;
  offset: number;
};
