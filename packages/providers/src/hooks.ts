/**
 * Shared Hook Types
 *
 * These types are used by multiple packages. No logic here — only types.
 * Keep in sync with the plan at docs/providers/registry-plan.md.
 */

// ── Context passed to every hook ─────────────────────────────────────────────

export type HookContext = {
  /** Model being invoked */
  model?: string;
  /** Session id for context */
  sessionId?: string;
  /** Provider id */
  providerId?: string;
  /** Vendor family (maps to vendorFamilySchema in @openaidy/config) */
  vendorFamily?: 'openai-compatible' | 'anthropic' | 'gemini';
  /** Reasoning/thinking configuration */
  reasoningConfig?: {
    enabled?: boolean;
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };
  /** Arbitrary extra context */
  extra?: Record<string, unknown>;
};

// ── Stream chunk hook ─────────────────────────────────────────────────────────

/**
 * A streamed chunk as it comes off the wire.
 *
 * The `delta` field is required but the shape varies by provider:
 * - OpenAI-compatible: delta is a string
 * - Anthropic: delta has .type and .text fields
 * - Gemini: delta has .text or .candidate fields
 * Providers override `onStreamChunk` to handle provider-specific shapes.
 */
export type StreamChunk = {
  /** The raw delta content (shape varies by provider/stream format) */
  delta: unknown;
  /** Content type when not using delta string (e.g. "content_delta", "reasoning_delta") */
  type?: string;
  /** Role delta (for streaming role changes) */
  role?: string;
  /** Tool call delta */
  toolCall?: unknown;
  /** Reasoning content delta (DeepSeek, MiniMax, etc.) */
  reasoningContent?: string;
  /** Finish reason when present */
  finishReason?: string;
  /** Text content when using type-based chunk format */
  text?: string;
  /** Arbitrary extra fields */
  [key: string]: unknown;
};

// ── BuildRequest hook ─────────────────────────────────────────────────────────

/**
 * Called before sending a request.
 *
 * Return extra fields to inject into the request:
 *   extraBody  → goes into request body extra_body
 *   topLevel   → goes into root request body (e.g. reasoning_effort)
 *   headers    → extra request headers
 *
 * DeepSeek uses this to inject: extraBody: { thinking: { type: 'enabled' } }
 * OpenRouter uses this to inject: extraBody: { provider: { ... } }
 */
export type BuildRequestHook = (context: HookContext) => {
  extraBody?: Record<string, unknown>;
  topLevel?: Record<string, unknown>;
  headers?: Record<string, string>;
};

// ── Stream chunk processor ───────────────────────────────────────────────────

/**
 * Called on each streamed chunk. Providers like DeepSeek/MiniMax use this
 * to accumulate `reasoning_content` deltas into a running string.
 *
 * Return the (possibly modified) chunk. The adapter accumulates any
 * `reasoningContent` field returned into the running reasoning tracker.
 */
export type OnStreamChunkHook = (
  chunk: StreamChunk,
  context: HookContext,
) => StreamChunk;

// ── PrepareMessages hook ─────────────────────────────────────────────────────

/**
 * Called on the messages array before sending.
 *
 * Providers can use this to:
 * - Inject a system prompt prefix (DeepSeek requires this for thinking mode)
 * - Transform message roles (some providers have role restrictions)
 * - Remove or redact content based on provider rules
 */
export type PrepareMessagesHook = (
  messages: unknown[],
  context: HookContext,
) => unknown[];
