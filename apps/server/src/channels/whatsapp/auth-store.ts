import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Creates a Baileys multi-file auth state scoped to one channel.
 * Credentials are stored under:
 *   {authBaseDir}/whatsapp-{channelId}/
 *
 * The directory is created if it does not exist.
 */
export async function createWhatsAppAuthStore(
  authBaseDir: string,
  channelId: string,
) {
  const dir = path.join(authBaseDir, `whatsapp-${channelId}`);
  mkdirSync(dir, { recursive: true });
  return useMultiFileAuthState(dir);
}
