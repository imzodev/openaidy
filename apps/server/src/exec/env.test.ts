import { describe, it, expect } from 'vitest';
import { buildScrubbedEnv } from './env';

describe('buildScrubbedEnv', () => {
  it('excludes secrets and keeps the baseline allowlist', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/agent',
      DATABASE_URL: 'postgres://user:pass@host/db',
      WS_TOKEN_SECRET: 'super-secret',
      CREDENTIALS_MASTER_KEY: 'master-key',
      OPENAI_API_KEY: 'sk-leak',
    };

    const scrubbed = buildScrubbedEnv(source);

    expect(scrubbed.PATH).toBe('/usr/bin');
    expect(scrubbed.HOME).toBe('/home/agent');
    expect(scrubbed.DATABASE_URL).toBeUndefined();
    expect(scrubbed.WS_TOKEN_SECRET).toBeUndefined();
    expect(scrubbed.CREDENTIALS_MASTER_KEY).toBeUndefined();
    expect(scrubbed.OPENAI_API_KEY).toBeUndefined();
  });

  it('matches allowlist entries case-insensitively (Windows env names)', () => {
    const source: NodeJS.ProcessEnv = {
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      Path: 'C:\\bin',
    };

    const scrubbed = buildScrubbedEnv(source);

    expect(scrubbed.SystemRoot).toBe('C:\\Windows');
    expect(scrubbed.ComSpec).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(scrubbed.Path).toBe('C:\\bin');
  });

  it('honors an extra allowlist for legitimate deployment needs', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      MY_TOOL_HOME: '/opt/tool',
      SECRET_THING: 'nope',
    };

    const scrubbed = buildScrubbedEnv(source, ['MY_TOOL_HOME']);

    expect(scrubbed.MY_TOOL_HOME).toBe('/opt/tool');
    expect(scrubbed.SECRET_THING).toBeUndefined();
  });

  it('skips undefined values', () => {
    const source: NodeJS.ProcessEnv = { PATH: undefined };
    const scrubbed = buildScrubbedEnv(source);
    expect('PATH' in scrubbed).toBe(false);
  });
});
