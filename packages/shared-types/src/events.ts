export type StreamEvent<TType extends string, TPayload> = {
  type: TType;
  payload: TPayload;
  emittedAt: string;
};

export type SessionCreatedEvent = StreamEvent<'session.created', { sessionId: string }>;
