---
summary: 'Export your OpenAidy data to a zip and restore it on another server'
read_when:
  - You want to back up OpenAidy or move it to a different machine
title: 'Backups'
---

# Backups

**System → Backups** in the web UI exports your OpenAidy data to a single `.zip` file and restores it, on the same server or a different one. Moving to a new machine is: export on the old server, install OpenAidy on the new one, import there.

## What's in a backup

Pick any combination of sections:

| Section        | Contents                                                     |
| -------------- | ------------------------------------------------------------ |
| **Database**   | Agents, sessions and transcripts, tasks, schedules, memories |
| **Config**     | `openaidy.json`: providers, channels, MCP servers, settings  |
| **Workspaces** | Every agent's workspace files                                |
| **Skills**     | Installed skills                                             |
| **Addons**     | Installed addons                                             |

The page shows the size of each section before you start.

## Exporting

1. Open **Backups → Export**, choose the sections, and click **Create Backup**.
2. The server builds the zip in the background, with a progress bar. You can leave the page and come back, and it picks the job up again. **Cancel** stops it and deletes the partial file.
3. When it finishes, your browser downloads the file like any normal download. It streams straight to disk, shows in your download list, and resumes if the connection drops.

The finished file stays on the server for an hour so you can **Download again**. **Delete from server** removes it sooner, and starting a new export replaces it.

The database is copied with SQLite's online snapshot, so the backup is consistent even while agents are running. Nothing needs to be stopped.

### Dependency and cache folders

By default, workspace exports skip folders that are large and can be rebuilt:

`node_modules`, `.git`, `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `.gradle`

Tick **Include dependency and cache folders in workspaces** to keep them. The checkbox shows how much space they add. Without them, you reinstall dependencies after restoring (`npm install`, `pip install -r requirements.txt`, and so on). Projects that use `.git` for history should either be pushed to a remote first or exported with the box ticked.

This filter only applies to workspaces. Skills and addons are always exported in full.

## Importing

1. Install OpenAidy on the target server and log in.
2. Open **Backups → Import** and choose the `.zip`. The upload shows its progress and can be cancelled.
3. The page lists what the backup contains. Choose the sections to restore and click **Restore**.
4. **Restart the server** if you restored the database or config (`openaidy restart`). Those take effect only after a restart. Workspaces, skills and addons are live straight away.

Restoring is non-destructive for files: existing files are kept and files with the same path are overwritten. The **database** and **config** sections are replaced as a whole. The new copy is fully extracted and checked before it replaces the old one, so a broken or truncated backup leaves your current data alone.

A backup made without dependency folders is flagged on the import screen as a reminder to reinstall them.

## Size limits

There's no fixed size cap. Exports, uploads and restores stream to and from disk, so memory use stays flat whatever the backup size, and a 1 GB droplet can handle backups of several gigabytes. What you do need is **free disk space**:

- **Export**: about the size of the zip, on the server.
- **Import**: the size of the zip plus the restored data.

The server keeps 256 MB free and refuses to start a job that wouldn't fit, rather than failing halfway through. Only one export or import runs at a time.

If your backup goes through a reverse proxy (Caddy, nginx), raise its request-size limit so large uploads aren't cut off. Caddy has no limit by default. On nginx, set `client_max_body_size 0;`.

## Moving to a new server, step by step

1. On the old server: **Backups → Export** with all sections, and download the zip.
2. On the new server: install OpenAidy, then run `openaidy service install` so it restarts on its own (see [Getting Started](./getting-started.md#keep-it-running-on-a-linux-server)).
3. On the new server: **Backups → Import** with all sections, then `openaidy restart`.
4. Reinstall any workspace dependencies you left out, and log in to your channels again if they ask you to.
5. **Stop the old server before the new one connects to WhatsApp or Discord.** Two servers with the same channel config both answer every message.
