import { For } from 'solid-js';
import type { BackupManifest, BackupSection } from '@openaidy/shared-types';
import { BACKUP_SECTIONS } from '@openaidy/shared-types';
import { formatBytes } from '../../lib/api-backups';

const SECTION_LABELS: Record<BackupSection, string> = {
  db: 'Database',
  config: 'Configuration',
  workspaces: 'Workspaces',
  skills: 'Skills',
  addons: 'Addons',
};

export type BackupManifestTableProps = {
  manifest: BackupManifest;
  /** Currently-selected sections. */
  selected: BackupSection[];
  onToggle: (section: BackupSection, checked: boolean) => void;
};

/** A checklist table of backup sections with item count + size. */
export function BackupManifestTable(props: BackupManifestTableProps) {
  const isSelected = (s: BackupSection) => props.selected.includes(s);

  return (
    <div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table class="min-w-full text-sm">
        <thead class="bg-gray-50 dark:bg-gray-800/60 text-text-tertiary">
          <tr>
            <th class="px-4 py-2 text-left font-medium w-10" />
            <th class="px-4 py-2 text-left font-medium">Section</th>
            <th class="px-4 py-2 text-right font-medium">Items</th>
            <th class="px-4 py-2 text-right font-medium">Size</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
          <For each={BACKUP_SECTIONS}>
            {(section) => {
              const summary = () => props.manifest.sections[section];
              return (
                <tr>
                  <td class="px-4 py-2.5">
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={isSelected(section)}
                      aria-label={SECTION_LABELS[section]}
                      onChange={(e) =>
                        props.onToggle(section, e.currentTarget.checked)
                      }
                    />
                  </td>
                  <td class="px-4 py-2.5 text-text-primary">
                    {SECTION_LABELS[section]}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                    {summary().itemCount}
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums text-text-secondary">
                    {formatBytes(summary().sizeBytes)}
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}
