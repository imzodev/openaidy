/**
 * Backup API client — manifest, export jobs (+ native download), uploads,
 * import jobs.
 *
 * Exports and imports are background jobs on the server: start one, then
 * poll it with `waitForBackupJob`. A finished export is downloaded by the
 * browser itself via a plain link (streams to disk, shows in the download
 * manager, resumes after a dropped connection) instead of being buffered
 * into a Blob here.
 */

import { getStoredToken } from './auth-token';
import { API_BASE } from './api';
import type {
  BackupJob,
  BackupJobResponse,
  BackupManifest,
  BackupSection,
  BackupUpload,
} from '@openaidy/shared-types';

function authHeader(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Human-readable byte size, e.g. 5242880 → "5.0 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function postJob(url: string, body: unknown, fallback: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, fallback));
  }
  return ((await response.json()) as BackupJobResponse).job;
}

/** Live snapshot of what a full backup would contain. */
export async function getBackupManifest(): Promise<BackupManifest> {
  const response = await fetch(`${API_BASE}/api/backups/manifest`, {
    headers: authHeader(),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Failed to load backup info'));
  }
  const body = (await response.json()) as { manifest: BackupManifest };
  return body.manifest;
}

/** Start building a backup zip on the server. Empty `sections` = all. */
export function startBackupExport(
  sections: BackupSection[],
  includeHeavyFolders: boolean,
): Promise<BackupJob> {
  return postJob(
    `${API_BASE}/api/backups/exports`,
    { sections, includeHeavyFolders },
    'Backup export failed',
  );
}

/** Current state of an export or import job. */
export async function getBackupJob(id: string): Promise<BackupJob> {
  const response = await fetch(`${API_BASE}/api/backups/jobs/${id}`, {
    headers: authHeader(),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Backup job not found'));
  }
  return ((await response.json()) as BackupJobResponse).job;
}

/** Cancel a running export, or discard a finished job (deletes its file). */
export async function cancelBackupJob(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/backups/jobs/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
}

/**
 * Poll a job until it leaves `running`, calling `onUpdate` with each state.
 * Transient network errors are retried — the job keeps running server-side.
 */
export async function waitForBackupJob(
  id: string,
  onUpdate: (job: BackupJob) => void,
  options: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<BackupJob> {
  const interval = options.intervalMs ?? 1000;
  let failures = 0;
  for (;;) {
    if (options.signal?.aborted) throw new Error('Stopped waiting');
    try {
      const job = await getBackupJob(id);
      failures = 0;
      onUpdate(job);
      if (job.status !== 'running') return job;
    } catch (err) {
      if (++failures >= 10) throw err;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Hand a finished export's download URL to the browser's download manager. */
export function downloadBackupFile(job: BackupJob): void {
  if (!job.downloadUrl) return;
  const a = document.createElement('a');
  a.href = `${API_BASE}${job.downloadUrl}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Upload a backup zip to the server's staging area. Uses XHR (not fetch) for
 * upload progress, which matters for multi-GB backups.
 */
export function uploadBackup(
  file: File,
  onProgress: (loaded: number, total: number) => void,
): { promise: Promise<BackupUpload>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<BackupUpload>((resolve, reject) => {
    xhr.open('POST', `${API_BASE}/api/backups/uploads`);
    for (const [k, v] of Object.entries(authHeader())) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as BackupUpload);
      } else {
        reject(
          new Error(
            (body as { error?: string } | undefined)?.error ??
              'Invalid backup file',
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — connection lost'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Discard a staged upload without importing it. */
export async function discardBackupUpload(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/backups/uploads/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
}

/** Start applying the selected sections from a staged upload. */
export function startBackupImport(
  uploadId: string,
  sections: BackupSection[],
): Promise<BackupJob> {
  return postJob(
    `${API_BASE}/api/backups/uploads/${uploadId}/import`,
    { sections },
    'Import failed',
  );
}
