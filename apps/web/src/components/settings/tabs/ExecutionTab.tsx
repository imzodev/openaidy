import { createMemo } from 'solid-js';
import {
  DynamicConfigForm,
  getExecutionSectionSchema,
  type FormSchema,
} from '../../../config';
import type { AppConfig } from '../../../lib/api';

interface ExecutionTabProps {
  config: () => AppConfig | undefined;
  onChange: (newConfig: Record<string, unknown>) => void;
}

export function ExecutionTab(props: ExecutionTabProps) {
  const executionSchema = createMemo((): FormSchema => {
    return { sections: [getExecutionSectionSchema()] };
  });

  return (
    <div class="p-6">
      <DynamicConfigForm
        config={
          { execution: props.config()?.execution } as Record<string, unknown>
        }
        schema={executionSchema()}
        onChange={props.onChange}
        errors={{}}
      />
    </div>
  );
}
