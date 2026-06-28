import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  FileText,
  Save,
  RotateCcw,
  Loader2,
  FileWarning,
  Image,
  FileArchive,
  AlertTriangle,
} from 'lucide-solid';
import {
  readWorkspaceFile,
  updateWorkspaceFile,
  type WorkspaceErrorResponse,
  type WorkspaceFileInfo,
  type WorkspaceFileContentResponse,
  type WorkspaceWriteResponse,
} from '../../lib/api';
import { CodeMirrorEditor } from './CodeMirrorEditor';

type WorkspaceEditorProps = {
  agentId: string;
  selectedFile: WorkspaceFileInfo | null;
  canWrite?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
  class?: string;
};

function isWorkspaceError(
  response:
    | WorkspaceFileContentResponse
    | WorkspaceWriteResponse
    | WorkspaceErrorResponse,
): response is WorkspaceErrorResponse {
  return 'error' in response;
}

export function WorkspaceEditor(props: WorkspaceEditorProps) {
  const [content, setContent] = createSignal('');
  const [originalContent, setOriginalContent] = createSignal('');
  const [isTextFile, setIsTextFile] = createSignal(true);
  const [mimeType, setMimeType] = createSignal('text/plain');
  const [detectedSize, setDetectedSize] = createSignal<number | null>(null);
  const [isTooLarge, setIsTooLarge] = createSignal(false);
  const [maxEditableBytes, setMaxEditableBytes] = createSignal<number | null>(
    null,
  );
  const [lastKnownModifiedAt, setLastKnownModifiedAt] = createSignal<
    string | null
  >(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = createSignal<Date | null>(null);

  const canWrite = createMemo(() => props.canWrite ?? true);
  const currentPath = createMemo(() => props.selectedFile?.path ?? null);
  const canRenderTextFile = createMemo(() => isTextFile() && !isTooLarge());
  const canSaveCurrentFile = createMemo(
    () => canWrite() && canRenderTextFile(),
  );
  const isDirty = createMemo(() => content() !== originalContent());

  const previewKind = createMemo<'image' | 'pdf' | 'archive' | 'other'>(() => {
    const currentMime = mimeType().toLowerCase();
    if (currentMime.startsWith('image/')) {
      return 'image';
    }
    if (currentMime.includes('pdf')) {
      return 'pdf';
    }
    if (
      currentMime.includes('zip') ||
      currentMime.includes('gzip') ||
      currentMime.includes('7z')
    ) {
      return 'archive';
    }
    return 'other';
  });

  createEffect(() => {
    props.onDirtyChange?.(isDirty());
  });

  const resetEditor = () => {
    setContent('');
    setOriginalContent('');
    setIsTextFile(true);
    setMimeType('text/plain');
    setDetectedSize(null);
    setIsTooLarge(false);
    setMaxEditableBytes(null);
    setLastKnownModifiedAt(null);
    setError(null);
    setLastSavedAt(null);
  };

  const loadFile = async (filePath: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await readWorkspaceFile(props.agentId, filePath);

      if (isWorkspaceError(response)) {
        setError(response.error);
        setContent('');
        setOriginalContent('');
        setIsTextFile(true);
        setMimeType('text/plain');
        setDetectedSize(null);
        return;
      }

      setIsTextFile(response.isText);
      setMimeType(response.mimeType);
      setDetectedSize(response.size);
      setIsTooLarge(response.isTooLarge);
      setMaxEditableBytes(response.maxEditableBytes ?? null);
      setLastKnownModifiedAt(response.modifiedAt);
      setContent(response.isText ? response.content : '');
      setOriginalContent(response.isText ? response.content : '');
      setLastSavedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
      setContent('');
      setOriginalContent('');
      setIsTextFile(true);
      setMimeType('text/plain');
      setDetectedSize(null);
      setIsTooLarge(false);
      setMaxEditableBytes(null);
      setLastKnownModifiedAt(null);
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = async () => {
    const filePath = currentPath();
    if (!filePath || !canSaveCurrentFile() || !isDirty() || isSaving()) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await updateWorkspaceFile(
        props.agentId,
        filePath,
        content(),
        lastKnownModifiedAt() ?? undefined,
      );

      if (isWorkspaceError(response)) {
        if (response.code === 'CONFLICT') {
          setError('This file changed on disk. Reload and reapply your edits.');
        } else if (response.code === 'FILE_TOO_LARGE') {
          setError('This file is too large to edit in the workspace editor.');
        } else {
          setError(response.error);
        }
        return;
      }

      await loadFile(filePath);
      setLastSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setIsSaving(false);
    }
  };

  const revertChanges = () => {
    setContent(originalContent());
    setError(null);
  };

  createEffect(
    on(
      () => [props.agentId, currentPath()],
      ([, filePath]) => {
        if (!filePath) {
          resetEditor();
          return;
        }
        void loadFile(filePath);
      },
    ),
  );

  createEffect(() => {
    const keydownHandler = (event: KeyboardEvent) => {
      const hasSaveShortcut =
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 's' &&
        !event.shiftKey;

      if (!hasSaveShortcut) {
        return;
      }

      if (!currentPath() || !canSaveCurrentFile() || !isDirty()) {
        return;
      }

      event.preventDefault();
      void saveFile();
    };

    window.addEventListener('keydown', keydownHandler);
    onCleanup(() => {
      window.removeEventListener('keydown', keydownHandler);
    });
  });

  const formattedSavedTime = createMemo(() => {
    const savedAt = lastSavedAt();
    if (!savedAt) {
      return '';
    }

    return savedAt.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  });

  return (
    <div class={`flex flex-col h-full ${props.class ?? ''}`}>
      <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
        <div class="flex items-center gap-2 min-w-0">
          <FileText class="w-4 h-4 text-gray-500 flex-shrink-0" />
          <Show
            when={props.selectedFile}
            fallback={
              <span class="text-sm text-text-tertiary">No file selected</span>
            }
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {props.selectedFile?.name}
              </p>
              <p class="text-xs text-text-tertiary truncate">
                /{props.selectedFile?.path}
              </p>
            </div>
          </Show>
        </div>

        <div class="flex items-center gap-2">
          <Show when={isDirty()}>
            <span class="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Unsaved changes
            </span>
          </Show>
          <Show when={!isTextFile() && props.selectedFile}>
            <span class="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
              Non-text file
            </span>
          </Show>
          <Show when={!canWrite() && props.selectedFile}>
            <span class="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              Read only
            </span>
          </Show>
          <button
            type="button"
            onClick={revertChanges}
            disabled={
              !isDirty() || isSaving() || isLoading() || !props.selectedFile
            }
            class="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Revert changes"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            Revert
          </button>
          <button
            type="button"
            onClick={() => void saveFile()}
            disabled={
              !isDirty() ||
              !canSaveCurrentFile() ||
              isSaving() ||
              isLoading() ||
              !props.selectedFile
            }
            class="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded bg-primary text-white hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed"
            title="Save (Ctrl/Cmd+S)"
          >
            <Show when={isSaving()} fallback={<Save class="w-3.5 h-3.5" />}>
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
            </Show>
            Save
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="mx-3 mt-3 p-3 text-sm rounded border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error()}
        </div>
      </Show>

      <Show
        when={props.selectedFile}
        fallback={
          <div class="flex-1 flex items-center justify-center text-text-tertiary text-sm p-6">
            Select a file from the browser to preview or edit it.
          </div>
        }
      >
        <Show
          when={!isLoading()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-text-tertiary text-sm">
              <Loader2 class="w-4 h-4 animate-spin mr-2" />
              Loading file...
            </div>
          }
        >
          <Show
            when={canRenderTextFile()}
            fallback={
              <div class="flex-1 flex items-center justify-center p-6">
                <div class="w-full max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm text-center text-text-tertiary">
                  <Show
                    when={isTooLarge()}
                    fallback={
                      <>
                        <Show
                          when={previewKind() === 'image'}
                          fallback={
                            <Show
                              when={previewKind() === 'archive'}
                              fallback={
                                <Show
                                  when={previewKind() === 'pdf'}
                                  fallback={
                                    <FileWarning class="w-8 h-8 mx-auto mb-3 text-gray-400" />
                                  }
                                >
                                  <FileText class="w-8 h-8 mx-auto mb-3 text-gray-400" />
                                </Show>
                              }
                            >
                              <FileArchive class="w-8 h-8 mx-auto mb-3 text-gray-400" />
                            </Show>
                          }
                        >
                          <Image class="w-8 h-8 mx-auto mb-3 text-gray-400" />
                        </Show>

                        <p class="font-medium text-gray-700 dark:text-gray-200 mb-1">
                          Preview only
                        </p>
                        <p class="mb-2">
                          This file type is not editable in the workspace
                          editor.
                        </p>
                        <p>Detected type: {mimeType()}</p>
                      </>
                    }
                  >
                    <AlertTriangle class="w-8 h-8 mx-auto mb-3 text-amber-500" />
                    <p class="font-medium text-gray-700 dark:text-gray-200 mb-1">
                      File too large
                    </p>
                    <p class="mb-2">
                      This file exceeds the inline editor limit.
                    </p>
                    <p>
                      Size: {detectedSize() ?? 0} bytes
                      <Show when={maxEditableBytes()}>
                        {(limit) => ` (max editable ${limit()} bytes)`}
                      </Show>
                    </p>
                  </Show>
                </div>
              </div>
            }
          >
            <CodeMirrorEditor
              value={content()}
              onChange={setContent}
              readOnly={!canWrite()}
              filePath={props.selectedFile?.path}
            />
          </Show>
        </Show>
      </Show>

      <div class="px-3 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-text-tertiary flex items-center justify-between">
        <span>
          <Show when={props.selectedFile} fallback={'No file open'}>
            {(file) => `${detectedSize() ?? file().size} bytes`}
          </Show>
        </span>
        <span>
          <Show
            when={formattedSavedTime()}
            fallback={isDirty() ? 'Modified' : 'Press Ctrl/Cmd+S to save'}
          >
            Saved at {formattedSavedTime()}
          </Show>
        </span>
      </div>
    </div>
  );
}
