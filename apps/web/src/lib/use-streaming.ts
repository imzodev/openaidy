/**
 * Streaming Hook
 *
 * Provides stream lifecycle management for WebSocket session streaming.
 * Handles session.stream.* events: start, delta, tool_call, usage, end, error.
 */

import { createSignal, onCleanup, type Accessor } from 'solid-js';
import type {
  SessionStreamStart,
  SessionStreamDelta,
  SessionStreamToolCall,
  SessionStreamUsage,
  SessionStreamError,
  SessionStreamEvent,
} from '@openaidy/shared-types';
import type { WebSocketClient } from '@openaidy/sdk';

export type StreamingState =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'completed'
  | 'error';

export interface StreamingDelta {
  content: string;
  runId: string;
}

export interface StreamingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamingUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface UseStreamingOptions {
  client: WebSocketClient;
  sessionId: string;
  onMessage?: (content: string) => void;
  onComplete?: (usage?: StreamingUsage) => void;
  onError?: (error: string) => void;
}

export interface UseStreamingReturn {
  state: Accessor<StreamingState>;
  deltas: Accessor<StreamingDelta[]>;
  toolCalls: Accessor<StreamingToolCall[]>;
  usage: Accessor<StreamingUsage | null>;
  isStreaming: Accessor<boolean>;
  error: Accessor<string | null>;
  start: (message: string) => Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * Create streaming hook for a session
 */
export function useStreaming(options: UseStreamingOptions): UseStreamingReturn {
  const { client, sessionId, onMessage, onComplete, onError } = options;

  const [state, setState] = createSignal<StreamingState>('idle');
  const [deltas, setDeltas] = createSignal<StreamingDelta[]>([]);
  const [toolCalls, setToolCalls] = createSignal<StreamingToolCall[]>([]);
  const [usage, setUsage] = createSignal<StreamingUsage | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let currentRunId: string | null = null;

  const handleStreamEvent = (event: SessionStreamEvent) => {
    const { type, payload } = event;

    switch (type) {
      case 'session.stream.start': {
        const start = payload as SessionStreamStart['payload'];
        currentRunId = start.runId;
        setState('starting');
        setDeltas([]);
        setToolCalls([]);
        setUsage(null);
        setError(null);
        break;
      }

      case 'session.stream.delta': {
        const delta = payload as SessionStreamDelta['payload'];
        setState('streaming');
        const newDelta: StreamingDelta = {
          content: delta.content,
          runId: delta.runId,
        };
        setDeltas((prev) => [...prev, newDelta]);
        if (onMessage) {
          onMessage(delta.content);
        }
        break;
      }

      case 'session.stream.tool_call': {
        const toolCallPayload = payload as SessionStreamToolCall['payload'];
        const newToolCall: StreamingToolCall = {
          id: toolCallPayload.toolCall.id,
          name: toolCallPayload.toolCall.name,
          input: toolCallPayload.toolCall.arguments,
        };
        setToolCalls((prev) => [...prev, newToolCall]);
        break;
      }

      case 'session.stream.usage': {
        const usagePayload = payload as SessionStreamUsage['payload'];
        const streamingUsage: StreamingUsage = {
          inputTokens: usagePayload.usage.promptTokens,
          outputTokens: usagePayload.usage.completionTokens,
          totalTokens: usagePayload.usage.totalTokens,
          ...(usagePayload.usage.cacheReadTokens !== undefined && {
            cacheReadTokens: usagePayload.usage.cacheReadTokens,
          }),
          ...(usagePayload.usage.cacheCreationTokens !== undefined && {
            cacheCreationTokens: usagePayload.usage.cacheCreationTokens,
          }),
        };
        setUsage(streamingUsage);
        break;
      }

      case 'session.stream.end': {
        setState('completed');
        if (onComplete) {
          onComplete(usage() ?? undefined);
        }
        break;
      }

      case 'session.stream.error': {
        const errorPayload = payload as SessionStreamError['payload'];
        setState('error');
        const errorMessage = errorPayload.error.message;
        setError(errorMessage);
        if (onError) {
          onError(errorMessage);
        }
        break;
      }
    }
  };

  // Subscribe to stream events when hook is created
  const unsubscribeStart = client.on('session.stream.start', handleStreamEvent);
  const unsubscribeDelta = client.on('session.stream.delta', handleStreamEvent);
  const unsubscribeToolCall = client.on(
    'session.stream.tool_call',
    handleStreamEvent,
  );
  const unsubscribeUsage = client.on('session.stream.usage', handleStreamEvent);
  const unsubscribeEnd = client.on('session.stream.end', handleStreamEvent);
  const unsubscribeError = client.on('session.stream.error', handleStreamEvent);

  const isStreaming = () => state() === 'streaming' || state() === 'starting';

  const start = async (message: string) => {
    setState('starting');
    setDeltas([]);
    setToolCalls([]);
    setUsage(null);
    setError(null);

    try {
      // Subscribe to the session for streaming events
      await client.subscribeToSession(sessionId);

      // Send the message with stream: true
      await client.sendRequest('session.message', {
        sessionId,
        message,
        stream: true,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to start streaming';
      setState('error');
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    }
  };

  const cancel = async () => {
    if (currentRunId) {
      try {
        await client.sendRequest('session.stream.cancel', {
          sessionId,
          runId: currentRunId,
        });
      } catch {
        // Ignore cancel errors
      }
    }
    setState('idle');
    currentRunId = null;
  };

  // Cleanup subscriptions on unmount
  onCleanup(() => {
    unsubscribeStart();
    unsubscribeDelta();
    unsubscribeToolCall();
    unsubscribeUsage();
    unsubscribeEnd();
    unsubscribeError();
  });

  return {
    state,
    deltas,
    toolCalls,
    usage,
    isStreaming,
    error,
    start,
    cancel,
  };
}
