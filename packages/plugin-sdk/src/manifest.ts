export type PluginKind = 'tool' | 'channel' | 'ui' | 'automation' | 'provider';

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  capabilities: string[];
};
