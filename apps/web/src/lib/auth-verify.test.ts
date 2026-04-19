import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthVerifyResponse } from '@openaidy/shared-types';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    verifyToken: vi.fn(),
  };
});

import { verifyToken } from './api';

const mockVerifyToken = vi.mocked(verifyToken);

describe('verifyToken', () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
  });

  it('returns valid response with scopes on success', async () => {
    const response: AuthVerifyResponse = {
      valid: true,
      clientId: 'admin_abc123',
      scopes: ['admin', 'pairing'],
      expiresAt: '2026-04-02T10:00:00.000Z',
    };
    mockVerifyToken.mockResolvedValue(response);

    const result = await verifyToken('valid-jwt-token');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.clientId).toBe('admin_abc123');
      expect(result.scopes).toContain('admin');
    }
  });

  it('returns invalid response with error message on bad token', async () => {
    const response: AuthVerifyResponse = {
      valid: false,
      error: 'Invalid or expired token',
    };
    mockVerifyToken.mockResolvedValue(response);

    const result = await verifyToken('bad-token');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Invalid or expired token');
    }
  });

  it('is called with the provided token', async () => {
    mockVerifyToken.mockResolvedValue({
      valid: false,
      error: 'Invalid or expired token',
    });
    await verifyToken('some-token');
    expect(mockVerifyToken).toHaveBeenCalledWith('some-token');
  });
});
