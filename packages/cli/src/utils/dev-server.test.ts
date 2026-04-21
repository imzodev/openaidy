/**
 * Dev Server Tests
 */

import { describe, it, expect } from 'vitest';
import {
  createServerConfig,
  getWatcherPatterns,
  validateServerConfig,
  createServerState,
  getServerStatus,
  getHMRConfig,
  generateViteConfig,
} from './dev-server.js';

describe('Dev Server Utils', () => {
  describe('createServerConfig', () => {
    it('should create server config with defaults', () => {
      const config = createServerConfig();
      expect(config.server).toHaveProperty('port', 3000);
      expect(config.server).toHaveProperty('host', 'localhost');
    });

    it('should create server config with custom options', () => {
      const config = createServerConfig({ port: 8080, host: '0.0.0.0' });
      expect(config.server).toHaveProperty('port', 8080);
      expect(config.server).toHaveProperty('host', '0.0.0.0');
    });

    it('should set up proxy when enabled', () => {
      const config = createServerConfig({ proxyEnabled: true });
      expect(config.proxy).toHaveProperty('/api');
      expect(config.proxy).toHaveProperty('/ws');
    });

    it('should not set up proxy when disabled', () => {
      const config = createServerConfig({ proxyEnabled: false });
      expect(Object.keys(config.proxy)).toHaveLength(0);
    });
  });

  describe('getWatcherPatterns', () => {
    it('should return default patterns', () => {
      const patterns = getWatcherPatterns();
      expect(patterns).toContain('src/**/*');
      expect(patterns).toContain('tests/**/*');
    });

    it('should return custom patterns', () => {
      const patterns = getWatcherPatterns(['custom/**/*']);
      expect(patterns).toEqual(['custom/**/*']);
    });
  });

  describe('validateServerConfig', () => {
    it('should validate valid config', () => {
      const result = validateServerConfig({ port: 3000, host: 'localhost' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid port', () => {
      const result = validateServerConfig({ port: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Port must be between 1 and 65535');
    });

    it('should reject empty host', () => {
      const result = validateServerConfig({ host: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Host cannot be empty');
    });

    it('should reject invalid URL', () => {
      const result = validateServerConfig({ openaidyUrl: 'not-a-url' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid OpenAidy URL format');
    });
  });

  describe('createServerState', () => {
    it('should create server state', () => {
      const state = createServerState(3000, 'localhost');
      expect(state.running).toBe(false);
      expect(state.port).toBe(3000);
      expect(state.host).toBe('localhost');
      expect(state.watchedFiles).toBeInstanceOf(Set);
    });
  });

  describe('getServerStatus', () => {
    it('should return server status', () => {
      const state = createServerState(3000, 'localhost');
      state.running = true;
      state.startTime = Date.now() - 5000;

      const status = getServerStatus(state);
      expect(status.running).toBe(true);
      expect(status.port).toBe(3000);
      expect(status.host).toBe('localhost');
      expect(status.uptime).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('getHMRConfig', () => {
    it('should return HMR configuration', () => {
      const config = getHMRConfig();
      expect(config).toHaveProperty('transport', 'websocket');
      expect(config).toHaveProperty('overlay', true);
    });
  });

  describe('generateViteConfig', () => {
    it('should generate valid Vite config JSON', () => {
      const configStr = generateViteConfig(
        'test-addon',
        'http://localhost:8080',
      );
      const config = JSON.parse(configStr);
      expect(config.server).toHaveProperty('port', 3000);
      expect(config.server).toHaveProperty('proxy');
    });
  });
});
