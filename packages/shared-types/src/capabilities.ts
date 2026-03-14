export type Capability =
  | 'sessions.read'
  | 'sessions.write'
  | 'dispatch.run'
  | 'channels.send'
  | 'channels.receive'
  | 'jobs.schedule'
  | 'config.read'
  | 'config.write'
  | 'mcp.use'
  | 'secrets.read';
