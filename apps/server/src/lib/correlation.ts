import { AsyncLocalStorage } from 'async_hooks';

export type CorrelationContext = {
  requestId?: string;
  sessionId?: string;
  runId?: string;
};

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function setCorrelationContext(ctx: CorrelationContext): void {
  correlationStorage.enterWith({ ...ctx });
}

export function getCorrelationContext(): CorrelationContext {
  return correlationStorage.getStore() ?? {};
}

export function clearCorrelationContext(): void {
  correlationStorage.enterWith({});
}
