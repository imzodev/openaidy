import { describe, it, expect, afterEach } from 'vitest';
import {
  detectInstalledService,
  renderUnit,
  unitPath,
} from './service-manager.js';

describe('renderUnit', () => {
  const base = {
    nodePath: '/opt/openaidy/node/bin/node',
    cliPath: '/opt/openaidy/node/bin/openaidy',
    openaidyHome: '/root/.openaidy',
    pathEnv: '/opt/openaidy/node/bin:/usr/bin',
    workingDirectory: '/root',
  };

  it('runs the CLI in foreground mode and restarts it on exit', () => {
    const unit = renderUnit({ ...base, scope: 'system' });
    expect(unit).toContain(
      'ExecStart="/opt/openaidy/node/bin/node" "/opt/openaidy/node/bin/openaidy" "start" "--foreground"',
    );
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('Environment="OPENAIDY_HOME=/root/.openaidy"');
    expect(unit).toContain(
      'Environment="PATH=/opt/openaidy/node/bin:/usr/bin"',
    );
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
      '"/opt/openaidy/node/bin/node" "--import" "tsx" "/opt/openaidy/node/bin/openaidy" "start" "--foreground" "--port" "4000"',
    );
    expect(unit).toContain('WantedBy=default.target');
  });

  it('escapes quotes and backslashes in paths', () => {
    const unit = renderUnit({
      ...base,
      scope: 'system',
      openaidyHome: '/data/my "home"\\x',
    });
    expect(unit).toContain(
      'Environment="OPENAIDY_HOME=/data/my \\"home\\"\\\\x"',
    );
  });

  it('never bakes the service opt-out into the unit', () => {
    // The server inherits the unit's env; if this leaked, its self-update
    // `openaidy restart` would bypass systemd and start a second server.
    expect(renderUnit({ ...base, scope: 'system' })).not.toContain(
      'OPENAIDY_NO_SERVICE',
    );
  });
});

describe('unitPath', () => {
  it('uses /etc/systemd/system for system scope and ~/.config for user scope', () => {
    expect(unitPath('system')).toBe('/etc/systemd/system/openaidy.service');
    expect(unitPath('user', '/home/ada')).toBe(
      '/home/ada/.config/systemd/user/openaidy.service',
    );
  });
});

describe('detectInstalledService', () => {
  afterEach(() => {
    process.env.OPENAIDY_NO_SERVICE = '1';
  });

  it('is disabled by OPENAIDY_NO_SERVICE=1', () => {
    process.env.OPENAIDY_NO_SERVICE = '1';
    expect(detectInstalledService()).toBeUndefined();
  });
});
