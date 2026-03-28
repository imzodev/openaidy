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
  const providerOptions = createMemo(() =>
    props.config()?.providers?.map((p) => ({
      id: p.id,
      name: p.name,
    })),
  );

  const agentOptions = createMemo(() =>
    props.config()?.agents?.map((a) => ({
      id: a.id,
      name: a.name,
    })),
  );

  const defaultsSchema = createMemo((): FormSchema => {
    return {
      sections: [
        getDefaultsSectionSchema({
          providers: providerOptions(),
          agents: agentOptions(),
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
