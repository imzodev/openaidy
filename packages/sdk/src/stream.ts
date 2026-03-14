export type AgentStreamChunk = {
  type: 'token' | 'done';
  value: string;
};
