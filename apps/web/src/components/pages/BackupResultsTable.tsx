import { For, Show } from 'solid-js';
import { CheckCircle, XCircle } from 'lucide-solid';
import type { BackupSection, ImportedSection } from '@openaidy/shared-types';

const SECTION_LABELS: Record<BackupSection, string> = {
  db: 'Database',
  config: 'Configuration',
  workspaces: 'Workspaces',
  skills: 'Skills',
  addons: 'Addons',
};

export type BackupResultsTableProps = {
  results: ImportedSection[];
};

/** Per-section outcome table shown after an import. */
export function BackupResultsTable(props: BackupResultsTableProps) {
  return (
    <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 dark:bg-gray-800/60 text-text-tertiary">
          <tr>
            <th class="px-4 py-2 text-left font-medium">Section</th>
            <th class="px-4 py-2 text-left font-medium">Result</th>
            <th class="px-4 py-2 text-right font-medium">Items</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
          <For each={props.results}>
            {(r) => (
              <tr>
                <td class="px-4 py-2.5 text-text-primary">
                  {SECTION_LABELS[r.section]}
                </td>
                <td class="px-4 py-2.5">
                  <Show
                    when={r.success}
                    fallback={
                      <span class="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
                        <XCircle class="w-4 h-4" />
                        {r.error ?? 'Failed'}
                      </span>
                    }
                  >
                    <span class="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400">
                      <CheckCircle class="w-4 h-4" />
                      Restored
                      <Show when={r.restartRequired}>
                        <span class="text-amber-600 dark:text-amber-400">
                          (restart required)
                        </span>
                      </Show>
                    </span>
                  </Show>
                </td>
                <td class="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                  {r.itemsImported}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
