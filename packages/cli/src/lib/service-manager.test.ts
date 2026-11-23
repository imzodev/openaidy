import { describe, it, expect, afterEach } from 'vitest';
import {
  detectInstalledService,
  renderUnit,
  unitPath,
} from './service-manager.js';

describe('renderUnit', () => {
  const base = {
    nodePath: '/opt/aidy/node/bin/node',
    cliPath: '/opt/aidy/node/bin/aidy',
    aidyHome: '/root/.aidy',
    pathEnv: '/opt/aidy/node/bin:/usr/bin',
    workingDirectory: '/root',
  };

  it('runs the CLI in foreground mode and restarts it on exit', () => {
    const unit = renderUnit({ ...base, scope: 'system' });
    expect(unit).toContain(
      'ExecStart="/opt/aidy/node/bin/node" "/opt/aidy/node/bin/aidy" "start" "--foreground"',
    );
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('Environment="AIDY_HOME=/root/.aidy"');
    expect(unit).toContain('Environment="PATH=/opt/aidy/node/bin:/usr/bin"');
    expect(unit).toContain('WantedBy=multi-user.target');
  });

  it('targets default.target for user units and passes --port and node flags', () => {
    const unit = renderUnit({
      ...base,
      scope: 'user',
      nodeArgs: ['--import', 'tsx'],
      port: 4000,
    });
    expect(unit).toContain(
      '"/opt/aidy/node/bin/node" "--import" "tsx" "/opt/aidy/node/bin/aidy" "start" "--foreground" "--port" "4000"',
    );
    expect(unit).toContain('WantedBy=default.target');
  });

  it('escapes quotes and backslashes in paths', () => {
    const unit = renderUnit({
      ...base,
      scope: 'system',
      aidyHome: '/data/my "home"\\x',
    });
    expect(unit).toContain('Environment="AIDY_HOME=/data/my \\"home\\"\\\\x"');
  });

  it('never bakes the service opt-out into the unit', () => {
    // The server inherits the unit's env; if this leaked, its self-update
    // `aidy restart` would bypass systemd and start a second server.
    expect(renderUnit({ ...base, scope: 'system' })).not.toContain(
      'AIDY_NO_SERVICE',
    );
  });
});

describe('unitPath', () => {
  it('uses /etc/systemd/system for system scope and ~/.config for user scope', () => {
    expect(unitPath('system')).toBe('/etc/systemd/system/aidy.service');
    expect(unitPath('user', '/home/ada')).toBe(
      '/home/ada/.config/systemd/user/aidy.service',
    );
  });
});

describe('detectInstalledService', () => {
  afterEach(() => {
    process.env.AIDY_NO_SERVICE = '1';
  });

  it('is disabled by AIDY_NO_SERVICE=1', () => {
    process.env.AIDY_NO_SERVICE = '1';
    expect(detectInstalledService()).toBeUndefined();
  });
});
