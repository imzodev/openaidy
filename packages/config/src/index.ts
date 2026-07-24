export * from './env';
export * from './jwt-secret';
export * from './provider';
export * from './app-config';

export type {
  WhatsAppChannelConfig,
  DiscordChannelConfig,
  ChannelConfig,
} from './app-config.js';
export {
  whatsappChannelConfigSchema,
  discordChannelConfigSchema,
  channelConfigSchema,
} from './app-config.js';
