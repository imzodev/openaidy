import { createMemo } from 'solid-js';
import {
  DynamicConfigForm,
  getDefaultsSectionSchema,
  type FormSchema,
} from '../../../config';
import type { AppConfig } from '../../../lib/api';

interface DefaultsTabProps {
  config: () => AppConfig | undefined;
  onChange: (newConfig: Record<string, unknown>) => void;
}

export function DefaultsTab(props: DefaultsTabProps) {
  const defaultsSchema = createMemo((): FormSchema => {
    const currentConfig = props.config();
    return {
      sections: [
        getDefaultsSectionSchema({
          providers: currentConfig?.providers?.map((p) => ({
            id: p.id,
            name: p.name,
          })),
          agents: currentConfig?.agents?.map((a) => ({
            id: a.id,
            name: a.name,
          })),
        }),
      ],
    };
  });

  return (
    <div class="p-6">
      <DynamicConfigForm
        config={
          { defaults: props.config()?.defaults } as Record<string, unknown>
        }
        schema={defaultsSchema()}
        onChange={props.onChange}
        errors={{}}
      />
    </div>
  );
}
