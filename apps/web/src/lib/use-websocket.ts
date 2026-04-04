import { useWebSocketContext } from './ws-provider';

export function useWebSocket() {
  return useWebSocketContext();
}
