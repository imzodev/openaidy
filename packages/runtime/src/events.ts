/**
 * Legacy runtime stream events - kept for backwards compatibility
 * @deprecated Use ModelStreamEvent from './provider' instead
 */
export type { ModelStreamEvent as RuntimeStreamEvent } from './provider';

// Re-export stream event types for convenience
export type {
  StreamStartedEvent,
  StreamContentDeltaEvent,
  StreamToolCallEvent,
  StreamUsageEvent,
  StreamFinishedEvent,
  StreamErrorEvent,
  isStreamStartedEvent,
  isStreamContentDeltaEvent,
  isStreamToolCallEvent,
  isStreamUsageEvent,
  isStreamFinishedEvent,
  isStreamErrorEvent,
} from './provider';
