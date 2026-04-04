/**
 * Base stream event type for internal event handling
 * 
 * Note: For WebSocket communication types, see websocket.ts
 * which defines SessionEvent, SessionStreamEvent, etc.
 */
export type StreamEvent<TType extends string, TPayload> = {
  type: TType;
  payload: TPayload;
  emittedAt: string;
};

/**
 * Internal event emitted when a session is created
 * @deprecated Use SessionCreatedEvent from websocket.ts for WebSocket communication
 */
export type SessionCreatedStreamEvent = StreamEvent<'session.created', { sessionId: string }>;
