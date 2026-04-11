import { For, Show, createSignal, createEffect, on } from 'solid-js';
import {
  Folder,
  File,
  ChevronRight,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-solid';
import {
  writeWorkspaceFile,
  deleteWorkspaceFile,
  renameWorkspaceFile,
  listWorkspaceFiles,
  type WorkspaceFileInfo,
  type WorkspaceFileListResponse,
  type WorkspaceWriteResponse,
  type WorkspaceErrorResponse,
} from '../../lib/api';

type FileExplorerProps = {
  /** The agent whose workspace to explore */
  agentId: string;
  /** The agent making the request (for permission check) */
  requestingAgentId: string;
  /** Optional controlled selected file path */
  selectedFilePath?: string | null;
  /** Whether write operations are allowed */
  canWrite?: boolean;
  /** Callback when a file is selected */
  onFileSelect?: (file: WorkspaceFileInfo) => void;
  /** Callback when a file is renamed */
  onFileRename?: (fromPath: string, toPath: string) => void;
  /** Callback when a file is deleted */
  onFileDelete?: (path: string) => void;
  /** Callback when a directory is selected */
  onDirectorySelect?: (path: string) => void;
  /** Optional class for styling */
  class?: string;
};

type FileNode = WorkspaceFileInfo & {
  children?: FileNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
};

function isErrorResponse(
  response:
    | WorkspaceFileListResponse
    | WorkspaceWriteResponse
    | WorkspaceErrorResponse,
): response is WorkspaceErrorResponse {
  return 'error' in response;
}

export function FileExplorer(props: FileExplorerProps) {
  const [files, setFiles] = createSignal<FileNode[]>([]);
  const [currentPath, setCurrentPath] = createSignal('');
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedFile, setSelectedFile] = createSignal<string | null>(null);

  const canWrite = () => props.canWrite ?? true;

  const fetchFiles = async (path: string = '') => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await listWorkspaceFiles(
        props.agentId,
        props.requestingAgentId,
        path || undefined,
      );

      if (isErrorResponse(response)) {
        setError(response.error);
      } else {
        const sortedItems = [...response.items].sort((a, b) => {
          // Directories first, then alphabetically
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(sortedItems);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load
  createEffect(
    on(
      () => [props.agentId, props.requestingAgentId],
      () => {
        setCurrentPath('');
        setSelectedFile(null);
        fetchFiles('');
      },
    ),
  );

  createEffect(() => {
    if (props.selectedFilePath === undefined) {
      return;
    }
    setSelectedFile(props.selectedFilePath);
  });

  const handleItemClick = (item: FileNode) => {
    if (item.isDirectory) {
      const newPath = currentPath()
        ? `${currentPath()}/${item.name}`
        : item.name;
      setCurrentPath(newPath);
      fetchFiles(newPath);
      props.onDirectorySelect?.(newPath);
    } else {
      setSelectedFile(item.path);
      props.onFileSelect?.(item);
    }
  };

  const handleBack = () => {
    const pathParts = currentPath().split('/');
    pathParts.pop();
    const newPath = pathParts.join('/');
    setCurrentPath(newPath);
    fetchFiles(newPath);
  };

  const handleRefresh = () => {
    fetchFiles(currentPath());
  };

  const makePathInCurrentDirectory = (name: string): string => {
    const trimmedName = name.trim().replace(/^\/+/, '');
    return currentPath() ? `${currentPath()}/${trimmedName}` : trimmedName;
  };

  const handleCreateFile = async () => {
    if (!canWrite()) {
      return;
    }

    const requestedName = window.prompt('Enter new file name');
    if (!requestedName) {
      return;
    }

    const filePath = makePathInCurrentDirectory(requestedName);
    if (!filePath) {
      return;
    }

    setError(null);
    const response = await writeWorkspaceFile(
      props.agentId,
      filePath,
      '',
      props.requestingAgentId,
    );

    if (isErrorResponse(response)) {
      setError(response.error);
      return;
    }

    await fetchFiles(currentPath());
  };

  const handleRenameFile = async (item: FileNode, event: MouseEvent) => {
    event.stopPropagation();
    if (!canWrite() || item.isDirectory) {
      return;
    }

    const nextName = window.prompt('Rename file', item.name);
    if (!nextName || nextName === item.name) {
      return;
    }

    const pathSegments = item.path.split('/');
    pathSegments.pop();
    const parentPath = pathSegments.join('/');
    const destinationPath = parentPath ? `${parentPath}/${nextName}` : nextName;

    setError(null);
    const response = await renameWorkspaceFile(
      props.agentId,
      item.path,
      destinationPath,
      props.requestingAgentId,
    );

    if (isErrorResponse(response)) {
      setError(response.error);
      return;
    }

    if (selectedFile() === item.path) {
      setSelectedFile(destinationPath);
    }
    props.onFileRename?.(item.path, destinationPath);
    await fetchFiles(currentPath());
  };

  const handleDeleteFile = async (item: FileNode, event: MouseEvent) => {
    event.stopPropagation();
    if (!canWrite() || item.isDirectory) {
      return;
    }

    const confirmed = window.confirm(`Delete file "${item.name}"?`);
    if (!confirmed) {
      return;
    }

    setError(null);
    const response = await deleteWorkspaceFile(
      props.agentId,
      item.path,
      props.requestingAgentId,
    );

    if (isErrorResponse(response)) {
      setError(response.error);
      return;
    }

    if (selectedFile() === item.path) {
      setSelectedFile(null);
    }
    props.onFileDelete?.(item.path);
    await fetchFiles(currentPath());
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div class={`flex flex-col h-full ${props.class || ''}`}>
      {/* Header with path and actions */}
      <div class="flex items-center justify-between p-2 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-1 text-sm text-text-secondary overflow-hidden">
          <Show when={currentPath()}>
            <button
              onClick={handleBack}
              class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              title="Go up"
            >
              <ChevronRight class="w-4 h-4 rotate-180" />
            </button>
          </Show>
          <span class="truncate font-mono text-xs">/{currentPath()}</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            onClick={handleCreateFile}
            disabled={!canWrite() || isLoading()}
            class="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
            title={canWrite() ? 'Create file' : 'Read-only workspace'}
          >
            <Plus class="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={isLoading()}
            class="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw class={`w-4 h-4 ${isLoading() ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading state */}
      <Show when={isLoading() && files().length === 0}>
        <div class="flex-1 flex items-center justify-center text-text-tertiary">
          <RefreshCw class="w-5 h-5 animate-spin mr-2" />
          <span>Loading files...</span>
        </div>
      </Show>

      {/* Error state */}
      <Show when={error()}>
        <div class="p-4 m-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
          {error()}
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!isLoading() && !error() && files().length === 0}>
        <div class="flex-1 flex flex-col items-center justify-center text-text-tertiary p-4">
          <Folder class="w-8 h-8 mb-2 opacity-50" />
          <p class="text-sm">Empty folder</p>
          <Show when={!currentPath()}>
            <p class="text-xs mt-1">No files in workspace</p>
          </Show>
        </div>
      </Show>

      {/* File list */}
      <Show when={!error() && files().length > 0}>
        <ul class="flex-1 overflow-y-auto p-1">
          <For each={files()}>
            {(item) => (
              <li>
                <div
                  onClick={() => handleItemClick(item)}
                  class={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors group ${
                    selectedFile() === item.path
                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-text-secondary'
                  }`}
                >
                  {/* Icon */}
                  <Show
                    when={item.isDirectory}
                    fallback={
                      <File class="w-4 h-4 flex-shrink-0 text-gray-400" />
                    }
                  >
                    <Folder class="w-4 h-4 flex-shrink-0 text-yellow-500" />
                  </Show>

                  {/* Name */}
                  <span class="flex-1 truncate text-sm">{item.name}</span>

                  {/* Size (files only) */}
                  <Show when={!item.isDirectory}>
                    <span class="text-xs text-text-tertiary hidden group-hover:inline">
                      {formatSize(item.size)}
                    </span>
                  </Show>

                  {/* Date */}
                  <span class="text-xs text-text-tertiary hidden lg:inline">
                    {formatDate(item.modifiedAt)}
                  </span>

                  <Show when={!item.isDirectory && canWrite()}>
                    <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        class="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                        title="Rename file"
                        onClick={(event) => handleRenameFile(item, event)}
                      >
                        <Pencil class="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        class="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
                        title="Delete file"
                        onClick={(event) => handleDeleteFile(item, event)}
                      >
                        <Trash2 class="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>

      {/* Footer with stats */}
      <Show when={!error() && files().length > 0}>
        <div class="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-xs text-text-tertiary">
          {files().filter((f) => f.isDirectory).length} folders,{' '}
          {files().filter((f) => !f.isDirectory).length} files
        </div>
      </Show>
    </div>
  );
}
