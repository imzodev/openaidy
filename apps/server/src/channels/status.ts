/**
 * Channel status projection
 *
 * Shared between the web-facing `/api/channels` routes and the addon-proxy
 * `/api/addon-proxy/channels` routes, so both report the exact same shape.
 */

import type { IChannel } from './interface.js';
import type { ChannelStatusResponse } from '@openaidy/shared-types';

export function toStatusResponse(channel: IChannel): ChannelStatusResponse {
  const error = channel.getLastError?.();
  return {
    id: channel.id,
    type: channel.type,
    status: channel.getStatus(),
    agentId: channel.agentId,
    ...(error ? { error } : {}),
  };
}
