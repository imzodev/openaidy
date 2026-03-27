import type { AppConfig, ProviderConfig, ConfigStatus } from '../../lib/api';

export type ConfigResponse =
  | { config: AppConfig; status: ConfigStatus }
  | { error: string };

export { type ConfigStatus };

export type ConfigTab = 'defaults' | 'providers' | 'agents' | 'raw';

export type SaveMessage = {
  type: 'success' | 'error';
  text: string;
} | null;

export type ProviderFormData = Partial<ProviderConfig> & {
  id: string;
  name: string;
  vendorFamily: ProviderConfig['vendorFamily'];
  enabled: boolean;
  baseUrl?: string;
  apiKeyEnv?: string;
};

export interface SettingsContextValue {
  config: () => AppConfig | undefined;
  configQuery: ReturnType<
    typeof import('@tanstack/solid-query').createQuery<
      () => unknown,
      Error,
      ConfigResponse
    >
  >;
  updateMutation: ReturnType<
    typeof import('@tanstack/solid-query').createMutation<
      () => unknown,
      Error,
      AppConfig,
      unknown
    >
  >;
  saveMessage: () => SaveMessage;
  setSaveMessage: (msg: SaveMessage) => void;
  rawJson: () => string;
  setRawJson: (json: string) => void;
}

export type CollapsibleCardProps = {
  title: string;
  index?: number;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'info';
  description?: string;
  showEnabled?: boolean;
  enabled?: boolean;
  onDelete: () => void;
  children: (isCollapsed: () => boolean) => import('solid-js').JSX.Element;
  isPending: boolean;
};
