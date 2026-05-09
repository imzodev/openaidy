import type { IChannel } from './interface.js';

/**
 * Holds all live channel instances keyed by their id.
 * Has no knowledge of channel types — works entirely through IChannel.
 */
export class ChannelRegistry {
  private readonly channels = new Map<string, IChannel>();

  register(channel: IChannel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel with id "${channel.id}" is already registered`);
    }
    this.channels.set(channel.id, channel);
  }

  get(id: string): IChannel | undefined {
    return this.channels.get(id);
  }

  getAll(): IChannel[] {
    return Array.from(this.channels.values());
  }

  /** Disconnects the channel then removes it from the registry */
  async remove(id: string): Promise<void> {
    const channel = this.channels.get(id);
    if (channel) {
      await channel.disconnect();
      this.channels.delete(id);
    }
  }

  has(id: string): boolean {
    return this.channels.has(id);
  }
}
