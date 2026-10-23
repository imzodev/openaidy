import {
  createSignal,
  createResource,
  createMemo,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Download, Upload, Loader, AlertCircle, X } from 'lucide-solid';
import { Layout } from './Layout';
import { Tabs } from '../ui/Tabs';
import { BackupManifestTable } from './BackupManifestTable';
import { BackupResultsTable } from './BackupResultsTable';
import {
  getBackupManifest,
  getBackupJob,
  startBackupExport,
  cancelBackupJob,
  waitForBackupJob,
  downloadBackupFile,
  uploadBackup,
  discardBackupUpload,
  startBackupImport,
  formatBytes,
} from '../../lib/api-backups';
import { BACKUP_SECTIONS } from '@openaidy/shared-types';
import type {
  BackupJob,
  BackupManifest,
  BackupSection,
  BackupUpload,
} from '@openaidy/shared-types';

type BackupTab = 'export' | 'import';

/** Remembers the running/finished export so leaving the page doesn't lose it. */
const EXPORT_JOB_KEY = 'openaidy:backups:export-job';

function rememberExportJob(id: string | undefined) {
  try {
    if (id) localStorage.setItem(EXPORT_JOB_KEY, id);
    else localStorage.removeItem(EXPORT_JOB_KEY);
  } catch {
    // storage unavailable — resuming after navigation just won't work
  }
}

function recalledExportJob(): string | undefined {
  try {
    return localStorage.getItem(EXPORT_JOB_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

const primaryButton =
  'inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 transition-colors';
const secondaryButton =
  'inline-flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium px-4 py-2 transition-colors';

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

function ProgressBar(props: {
  label: string;
  processed: number;
  total: number;
  onCancel?: () => void;
}) {
  const pct = () =>
    props.total > 0
      ? Math.min(100, Math.round((props.processed / props.total) * 100))
      : 0;
  return (
    <div class="space-y-1.5" role="status">
      <div class="flex items-center justify-between text-sm">
        <span class="flex items-center gap-2 text-text-secondary">
          <Loader class="w-4 h-4 animate-spin" />
          {props.label}
        </span>
        <span class="tabular-nums text-text-tertiary">
          {formatBytes(props.processed)} of {formatBytes(props.total)} · {pct()}
          %
        </span>
      </div>
      <div class="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          class="h-full bg-blue-600 transition-[width] duration-300"
          style={{ width: `${pct()}%` }}
        />
      </div>
      <Show when={props.onCancel}>
        <button
          type="button"
          class="inline-flex items-center gap-1 text-sm text-text-tertiary hover:text-text-primary"
          onClick={() => props.onCancel?.()}
        >
          <X class="w-3.5 h-3.5" /> Cancel
        </button>
      </Show>
    </div>
  );
}

function ErrorLine(props: { message: string | undefined }) {
  return (
    <Show when={props.message}>
      <p class="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
        <AlertCircle class="w-4 h-4" />
        {props.message}
      </p>
    </Show>
  );
}

function ExportTab() {
  const [manifest, { refetch }] = createResource(getBackupManifest);
  // Start with everything selected.
  const [selected, setSelected] = createSignal<BackupSection[]>([
    ...BACKUP_SECTIONS,
  ]);
  const [includeHeavy, setIncludeHeavy] = createSignal(false);
  const [job, setJob] = createSignal<BackupJob | undefined>();
  const [error, setError] = createSignal<string | undefined>();
  const poller = new AbortController();
  onCleanup(() => poller.abort());

  const toggle = (section: BackupSection, checked: boolean) => {
    setSelected((prev) =>
      checked
        ? [...new Set([...prev, section])]
        : prev.filter((s) => s !== section),
    );
  };

  // Sizes as they'll actually be exported: heavy folders drop out unless included.
  const shownManifest = createMemo<BackupManifest | undefined>(() => {
    const m = manifest();
    if (!m || includeHeavy()) return m;
    const ws = m.sections.workspaces;
    return {
      ...m,
      sections: {
        ...m.sections,
        workspaces: {
          ...ws,
          sizeBytes: Math.max(0, ws.sizeBytes - (ws.heavyBytes ?? 0)),
        },
      },
    };
  });
  const heavyBytes = () => manifest()?.sections.workspaces.heavyBytes ?? 0;
  const estimatedBytes = () => {
    const m = shownManifest();
    return m ? selected().reduce((n, s) => n + m.sections[s].sizeBytes, 0) : 0;
  };

  const follow = async (started: BackupJob) => {
    setJob(started);
    rememberExportJob(started.id);
    try {
      const done = await waitForBackupJob(started.id, setJob, {
        signal: poller.signal,
      });
      setJob(done);
      if (done.status === 'succeeded') downloadBackupFile(done);
      else if (done.status === 'failed')
        setError(done.error ?? 'Export failed');
    } catch (e) {
      if (!poller.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Lost track of the export');
      }
    }
  };

  onMount(() => {
    const id = recalledExportJob();
    if (!id) return;
    getBackupJob(id).then(
      (existing) => {
        if (existing.status === 'running') void follow(existing);
        else if (existing.status === 'succeeded') setJob(existing);
        else rememberExportJob(undefined);
      },
      () => rememberExportJob(undefined),
    );
  });

  const onCreate = async () => {
    setError(undefined);
    if (selected().length === 0) {
      setError('Select at least one section to export');
      return;
    }
    try {
      await follow(await startBackupExport(selected(), includeHeavy()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const onDiscard = async () => {
    const current = job();
    setJob(undefined);
    rememberExportJob(undefined);
    if (current) await cancelBackupJob(current.id);
  };

  const running = () => job()?.status === 'running';
  const ready = () => (job()?.status === 'succeeded' ? job() : undefined);

  return (
    <div class="space-y-4">
      <p class="text-sm text-text-secondary">
        Choose which sections to include. The backup is a <code>.zip</code> you
        can restore on another machine or keep as a safety copy. Provider API
        keys travel with the configuration section.
      </p>

      <Show
        when={shownManifest()}
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
          <>
            <BackupManifestTable
              manifest={m()}
              selected={selected()}
              onToggle={toggle}
            />
            <label class="flex items-start gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                class="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={includeHeavy()}
                disabled={running()}
                onChange={(e) => setIncludeHeavy(e.currentTarget.checked)}
              />
              <span>
                Include dependency and cache folders in workspaces (
                <code>node_modules</code>, <code>.git</code>, <code>.venv</code>
                , …)
                <Show when={heavyBytes() > 0}>
                  {' '}
                  — adds {formatBytes(heavyBytes())}
                </Show>
                <span class="block text-text-tertiary">
                  Usually rebuildable with your package manager. Leave off for a
                  smaller, faster backup.
                </span>
              </span>
            </label>
            <p class="text-sm text-text-tertiary">
              About {formatBytes(estimatedBytes())} before compression.
            </p>
          </>
        )}
      </Show>

      <ErrorLine message={error()} />

      <Show when={running() && job()}>
        {(j) => (
          <ProgressBar
            label={j().phase}
            processed={j().processedBytes}
            total={j().totalBytes}
            onCancel={() => void onDiscard()}
          />
        )}
      </Show>

      <Show when={ready()}>
        {(j) => (
          <div class="space-y-2 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/30 p-3 text-sm">
            <p class="text-text-primary">
              Backup ready ({formatBytes(j().fileSizeBytes ?? 0)}). Your
              download should start automatically.
              <Show when={j().expiresAt}>
                {' '}
                The file stays on the server until{' '}
                {new Date(j().expiresAt!).toLocaleTimeString()}.
              </Show>
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class={primaryButton}
                onClick={() => downloadBackupFile(j())}
              >
                <Download class="w-4 h-4" /> Download again
              </button>
              <button
                type="button"
                class={secondaryButton}
                onClick={() => void onDiscard()}
              >
                Delete from server
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={!running() && !ready()}>
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={!manifest()}
          class={primaryButton}
        >
          <Download class="w-4 h-4" />
          Create Backup
        </button>
      </Show>
    </div>
  );
}

function ImportTab() {
  const [file, setFile] = createSignal<File | undefined>();
  const [uploadProgress, setUploadProgress] = createSignal<
    { loaded: number; total: number } | undefined
  >();
  const [upload, setUpload] = createSignal<BackupUpload | undefined>();
  const [selected, setSelected] = createSignal<BackupSection[]>([]);
  const [job, setJob] = createSignal<BackupJob | undefined>();
  const [error, setError] = createSignal<string | undefined>();
  let abortUpload: (() => void) | undefined;
  const poller = new AbortController();
  onCleanup(() => {
    poller.abort();
    abortUpload?.();
  });

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
    input.value = '';
    setError(undefined);
    setJob(undefined);
    const previous = upload();
    setUpload(undefined);
    if (previous) void discardBackupUpload(previous.id);
    if (!chosen) return;
    setFile(chosen);
    setUploadProgress({ loaded: 0, total: chosen.size });
    const { promise, abort } = uploadBackup(chosen, (loaded, total) =>
      setUploadProgress({ loaded, total }),
    );
    abortUpload = abort;
    try {
      const staged = await promise;
      setUpload(staged);
      // Pre-check every section present in the backup.
      setSelected(
        BACKUP_SECTIONS.filter(
          (s) => staged.manifest.sections[s].itemCount > 0,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid backup file');
    } finally {
      abortUpload = undefined;
      setUploadProgress(undefined);
    }
  };

  const onRestore = async () => {
    const staged = upload();
    if (!staged) return;
    setError(undefined);
    if (selected().length === 0) {
      setError('Select at least one section to restore');
      return;
    }
    try {
      const started = await startBackupImport(staged.id, selected());
      setJob(started);
      const done = await waitForBackupJob(started.id, setJob, {
        signal: poller.signal,
      });
      setJob(done);
      setUpload(undefined); // consumed by the import
      if (done.status !== 'succeeded' && !done.results) {
        setError(done.error ?? 'Import failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const restoring = () => job()?.status === 'running';
  const results = () => (restoring() ? undefined : job()?.results);

  return (
    <div class="space-y-4">
      <p class="text-sm text-text-secondary">
        Workspaces, skills and addons are merged: existing files are kept and
        matching files are overwritten. The database and configuration are
        replaced entirely and take effect after a server restart.
      </p>

      <div>
        <label
          class={`${secondaryButton} cursor-pointer`}
          classList={{ 'pointer-events-none opacity-50': restoring() }}
        >
          <Upload class="w-4 h-4" />
          Choose Backup File
          <input
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            disabled={restoring()}
            onChange={(e) => void onFile(e)}
          />
        </label>
        <Show when={file()}>
          <span class="ml-2 text-sm text-text-tertiary">{file()!.name}</span>
        </Show>
      </div>

      <Show when={uploadProgress()}>
        {(p) => (
          <ProgressBar
            label="Uploading"
            processed={p().loaded}
            total={p().total}
            onCancel={() => abortUpload?.()}
          />
        )}
      </Show>

      <ErrorLine message={error()} />

      <Show when={upload() && !job()}>
        <div class="space-y-4">
          <BackupManifestTable
            manifest={upload()!.manifest}
            selected={selected()}
            onToggle={toggle}
          />
          <Show when={upload()!.manifest.includesHeavyFolders === false}>
            <p class="text-sm text-text-tertiary">
              This backup leaves out dependency and cache folders (
              <code>node_modules</code>, <code>.git</code>, …). Reinstall
              dependencies in restored workspaces before running their code.
            </p>
          </Show>
          <button
            type="button"
            onClick={() => void onRestore()}
            class={primaryButton}
          >
            <Download class="w-4 h-4" />
            Restore
          </button>
        </div>
      </Show>

      <Show when={restoring() && job()}>
        {(j) => (
          <ProgressBar
            label={j().phase}
            processed={j().processedBytes}
            total={j().totalBytes}
          />
        )}
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
