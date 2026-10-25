import type { BuiltinTool } from '@openaidy/runtime';
import type { ChannelRegistry } from '../../channels';
import { formatToolError, requireString } from '../shared.js';
import { channelSendMeta } from '../catalog.js';

/** Longest message sent in one call. */
const MAX_TEXT_CHARS = 4000;

/**
 * channel_send
 *
 * Sends a message on a connected channel outside a conversation: a
 * workflow telling the owner its daily summary, or reminding a customer
 * of tomorrow's appointment.
 */
export function createChannelSendTool(
  getChannels: () => ChannelRegistry | undefined,
): BuiltinTool {
  return {
    name: channelSendMeta.name,
    description: channelSendMeta.description,
    parameters: {
      type: 'object',
      properties: {
        channelId: {
          type: 'string',
          description: 'Channel to send on (its id, e.g. "my-whatsapp").',
        },
        to: {
          type: 'string',
          description:
            'Who to send to. WhatsApp: a phone number with country code ' +
            '(e.g. "+52 155 1234 5678") or a chat id. Discord: a channel id.',
        },
        text: { type: 'string', description: 'The message.' },
      },
      required: ['channelId', 'to', 'text'],
    },

    async execute(args, _ctx) {
      for (const field of ['channelId', 'to', 'text']) {
        const error = requireString(args[field], field);
        if (error) return { ok: false, error };
      }
      const channelId = args['channelId'] as string;
      const to = args['to'] as string;
      const text = (args['text'] as string).slice(0, MAX_TEXT_CHARS);

      const registry = getChannels();
      const channel = registry?.get(channelId);
      if (!channel) {
        const ids = registry?.getAll().map((c) => c.id) ?? [];
        return {
          ok: false,
          error: `Channel "${channelId}" not found.${ids.length ? ` Available: ${ids.join(', ')}` : ' No channels are set up.'}`,
        };
      }
      if (!channel.send) {
        return {
          ok: false,
          error: `Channel "${channelId}" can't send messages on its own.`,
        };
      }
      try {
        const sent = await channel.send(to, text);
        if (!sent) {
          return {
            ok: false,
            error: `Couldn't send on "${channelId}": it's ${channel.getStatus()}, or "${to}" can't be reached.`,
          };
        }
        return { ok: true, content: `Sent to ${to} on ${channelId}.` };
      } catch (err) {
        return formatToolError('Unexpected error sending message', err);
      }
    },
  };
}
