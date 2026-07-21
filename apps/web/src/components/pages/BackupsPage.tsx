import { createSignal, createResource, Show } from 'solid-js';
import { Download, Upload, Loader, AlertCircle } from 'lucide-solid';
import { Layout } from './Layout';
import { Tabs } from '../ui/Tabs';
import { BackupManifestTable } from './BackupManifestTable';
import { BackupResultsTable } from './BackupResultsTable';
import {
  getBackupManifest,
  downloadBackup,
  previewBackup,
  importBackup,
} from '../../lib/api-backups';
import { BACKUP_SECTIONS } from '@openaidy/shared-types';
import type {
  BackupSection,
  BackupPreview,
  ImportedSection,
} from '@openaidy/shared-types';

type BackupTab = 'export' | 'import';

export function BackupsPage() {
  const [tab, setTab] = createSignal<BackupTab>('export');

  return (
    <Layout title="Backups" description="Export and restore your OpenAidy data">
      <Tabs<BackupTab>
        tabs={[
          { id: 'export', label: 'Export' },
          { id: 'import', label: 'Import' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />
      <div class="bg-white dark:bg-gray-800 shadow rounded-b-lg p-4 sm:p-6">
        <Show when={tab() === 'export'}>
          <ExportTab />
        </Show>
        <Show when={tab() === 'import'}>
          <ImportTab />
        </Show>
      </div>
    </Layout>
  );
}

function ExportTab() {
  const [manifest, { refetch }] = createResource(getBackupManifest);
  // Start with everything selected.
  const [selected, setSelected] = createSignal<BackupSection[]>([
    ...BACKUP_SECTIONS,
  ]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  const toggle = (section: BackupSection, checked: boolean) => {
    setSelected((prev) =>
      checked
        ? [...new Set([...prev, section])]
        : prev.filter((s) => s !== section),
    );
  };

  const onDownload = async () => {
    setError(undefined);
    if (selected().length === 0) {
      setError('Select at least one section to export');
      return;
    }
    setBusy(true);
    try {
      await downloadBackup(selected());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-4">
      <p class="text-sm text-text-secondary">
        Choose which sections to include. The backup is a <code>.zip</code> you
        can restore on another machine or keep as a safety copy. Provider API
        keys travel with the configuration section.
      </p>

      <Show
        when={manifest()}
        fallback={
          <Show
            when={!manifest.error}
            fallback={
              <p class="text-sm text-red-600 dark:text-red-400">
                Failed to load backup info.{' '}
                <button class="underline" onClick={() => void refetch()}>
                  Retry
                </button>
              </p>
            }
          >
            <div class="flex items-center gap-2 text-sm text-text-tertiary py-6">
              <Loader class="w-4 h-4 animate-spin" /> Loading…
            </div>
          </Show>
        }
      >
        {(m) => (
          <BackupManifestTable
            manifest={m()}
            selected={selected()}
            onToggle={toggle}
          />
        )}
      </Show>

      <Show when={error()}>
        <p class="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle class="w-4 h-4" />
          {error()}
        </p>
      </Show>

      <button
        type="button"
        onClick={() => void onDownload()}
        disabled={busy() || !manifest()}
        class="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
      >
        <Show when={busy()} fallback={<Download class="w-4 h-4" />}>
          <Loader class="w-4 h-4 animate-spin" />
        </Show>
        {busy() ? 'Preparing…' : 'Download Backup'}
      </button>
    </div>
  );
}

function ImportTab() {
  const [file, setFile] = createSignal<File | undefined>();
  const [preview, setPreview] = createSignal<BackupPreview | undefined>();
  const [selected, setSelected] = createSignal<BackupSection[]>([]);
  const [results, setResults] = createSignal<ImportedSection[] | undefined>();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | undefined>();

  const toggle = (section: BackupSection, checked: boolean) => {
    setSelected((prev) =>
      checked
        ? [...new Set([...prev, section])]
        : prev.filter((s) => s !== section),
    );
  };

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    setError(undefined);
    setResults(undefined);
    setPreview(undefined);
    if (!chosen) return;
    setFile(chosen);
    setBusy(true);
    try {
      const p = await previewBackup(chosen);
      setPreview(p);
      // Pre-check every section present in the backup.
      setSelected(
        BACKUP_SECTIONS.filter((s) => p.manifest.sections[s].itemCount > 0),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup file');
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    const f = file();
    if (!f) return;
    setError(undefined);
    if (selected().length === 0) {
      setError('Select at least one section to restore');
      return;
    }
    setBusy(true);
    try {
      const res = await importBackup(f, selected());
      setResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-4">
      <p class="text-sm text-text-secondary">
        Restore is non-destructive: existing records are kept and matching files
        are overwritten. The database and configuration take effect after a
        server restart.
      </p>

      <div>
        <label class="inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium px-4 py-2 cursor-pointer transition-colors">
          <Upload class="w-4 h-4" />
          Choose Backup File
          <input
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            onChange={(e) => void onFile(e)}
          />
        </label>
        <Show when={file()}>
          <span class="ml-2 text-sm text-text-tertiary">{file()!.name}</span>
        </Show>
      </div>

      <Show when={error()}>
        <p class="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
          <AlertCircle class="w-4 h-4" />
          {error()}
        </p>
      </Show>

      <Show when={preview() && !results()}>
        <div class="space-y-4">
          <BackupManifestTable
            manifest={preview()!.manifest}
            selected={selected()}
            onToggle={toggle}
          />
          <button
            type="button"
            onClick={() => void onRestore()}
            disabled={busy()}
            class="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            <Show when={busy()} fallback={<Download class="w-4 h-4" />}>
              <Loader class="w-4 h-4 animate-spin" />
            </Show>
            {busy() ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </Show>

      <Show when={results()}>
        {(r) => (
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-text-primary">
              Import results
            </h3>
            <BackupResultsTable results={r()} />
          </div>
        )}
      </Show>
    </div>
  );
}
