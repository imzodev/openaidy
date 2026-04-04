/**
 * Device List Formatter
 * 
 * Formats pairing requests for CLI display.
 * Separates formatting logic from command handling.
 */

import type { PairingRequestData, PairingRequestStatus } from '@openaidy/control-plane';

/**
 * Format a single pairing request for display
 */
export function formatRequest(req: PairingRequestData): string {
  const lines: string[] = [];
  
  lines.push(`  Request ID: ${req.requestId}`);
  lines.push(`  Device:     ${req.deviceName} (${req.deviceType})`);
  lines.push(`  Code:       ${req.pairingCode}`);
  lines.push(`  Status:     ${req.status}`);
  lines.push(`  Created:    ${new Date(req.requestedAt).toISOString()}`);
  lines.push(`  Expires:    ${new Date(req.expiresAt).toISOString()}`);
  lines.push(`  Scopes:     ${req.capabilities.join(', ')}`);
  
  return lines.join('\n');
}

/**
 * Format a list of pairing requests for display
 */
export function formatRequestList(
  requests: PairingRequestData[],
  title = 'Pending Device Pairing Requests',
): string {
  if (requests.length === 0) {
    return `No ${title.toLowerCase()}.`;
  }
  
  const lines: string[] = [];
  
  lines.push(title);
  lines.push('='.repeat(title.length));
  lines.push('');
  
  for (const req of requests) {
    lines.push(formatRequest(req));
    lines.push('');
  }
  
  lines.push(`Total: ${requests.length} request(s)`);
  
  return lines.join('\n');
}

/**
 * Format empty state for device list
 */
export function formatEmptyState(status: string = 'pending'): string {
  const statusText = status === 'pending' ? 'pending' : status;
  return `No ${statusText} device pairing requests.`;
}

/**
 * Format requests filtered by status
 */
export function formatRequestsByStatus(
  requests: PairingRequestData[],
  status: PairingRequestStatus,
): string {
  const filtered = requests.filter(r => r.status === status);
  const title = status === 'pending' 
    ? 'Pending Device Pairing Requests'
    : `${status.charAt(0).toUpperCase() + status.slice(1)} Device Pairing Requests`;
  
  return formatRequestList(filtered, title);
}

/**
 * Sort requests by requestedAt (newest first)
 */
export function sortRequestsByDate(requests: PairingRequestData[]): PairingRequestData[] {
  return [...requests].sort((a, b) => b.requestedAt - a.requestedAt);
}

/**
 * Calculate time until expiration
 */
export function getTimeUntilExpiration(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;
  
  if (diff <= 0) {
    return 'expired';
  }
  
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  
  return `${seconds}s`;
}

/**
 * Format request with expiration countdown
 */
export function formatRequestWithExpiry(req: PairingRequestData): string {
  const base = formatRequest(req);
  const timeLeft = getTimeUntilExpiration(req.expiresAt);
  
  return `${base}\n  Expires in: ${timeLeft}`;
}
