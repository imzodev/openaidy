export type RuntimeStreamEvent = {
  type: 'runtime.started' | 'runtime.chunk' | 'runtime.completed';
  timestamp: string;
};
