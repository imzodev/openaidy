/**
 * Providers context for field renderers
 *
 * Provides access to available providers for dynamic options
 * (e.g., model selection) without requiring prop threading.
 */

import { createContext, useContext, type JSX } from 'solid-js';
import type { ProviderConfig } from '../../lib/api';

export type ProvidersContextValue = () => ProviderConfig[] | undefined;

export const ProvidersContext = createContext<ProvidersContextValue>(
  () => undefined,
);

export function useProviders(): ProviderConfig[] | undefined {
  return useContext(ProvidersContext)();
}

export type ProvidersProviderProps = {
  providers: ProviderConfig[] | undefined;
  children: JSX.Element;
};

export function ProvidersProvider(props: ProvidersProviderProps) {
  return (
    <ProvidersContext.Provider value={() => props.providers}>
      {props.children}
    </ProvidersContext.Provider>
  );
}
