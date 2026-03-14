export class DispatchService {
  async dispatchSessionRun(sessionId: string) {
    return {
      sessionId,
      status: 'queued' as const,
      queuedAt: new Date().toISOString(),
    };
  }
}
