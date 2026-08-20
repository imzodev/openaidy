import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { Send, ListPlus, Paperclip, X, Music } from 'lucide-solid';
import { AgentPicker } from './AgentPicker';
import type { Agent } from '../lib/api';

type ChatComposerProps = {
  onSend: (content: string, agentId?: string, files?: File[]) => Promise<void>;
  /** Hard-disable the composer (e.g. no session / disconnected). */
  disabled?: boolean;
  /**
   * The agent is currently responding. The composer stays usable; submitting
   * queues the message instead of sending it immediately.
   */
  isStreaming?: boolean;
  placeholder?: string;
  agents: Agent[];
  selectedAgentId?: string;
  onAgentSelect: (agentId: string | undefined) => void;
  /**
   * Called with a focus function when the component mounts, and with
   * `undefined` when it unmounts, so the parent never holds a reference to
   * a focus function belonging to an already-unmounted composer.
   */
  onInputReady?: (focus: (() => void) | undefined) => void;
  /**
   * Attachments aren't supported in private chats (bytes live on disk
   * regardless of the session's persistence flag). Hides/disables the
   * attach button and ignores paste/drop of files.
   */
  attachmentsDisabled?: boolean;
};

/** Mime prefixes accepted as chat attachments. */
const ACCEPTED_MIME_PREFIXES = ['image/', 'audio/', 'video/'];

function isAcceptedFile(file: File): boolean {
  return ACCEPTED_MIME_PREFIXES.some((p) => file.type.startsWith(p));
}

export function ChatComposer(props: ChatComposerProps) {
  const [input, setInput] = createSignal('');
  const [isSending, setIsSending] = createSignal(false);
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);
  // Below Tailwind's `md` (768px) we use the mobile layout: the agent picker
  // moves to a chip above the input, and the send button is merged into the
  // input pill — reclaiming horizontal room for typing. Defaults to desktop
  // when matchMedia is unavailable (e.g. jsdom under test).
  const [isMobile, setIsMobile] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  // Queue mode: usable composer, but submitting enqueues for later send.
  const isQueueing = () => !!props.isStreaming && !props.disabled;

  // Expose focus function to parent via callback when textarea is mounted,
  // and clear it on unmount so the parent doesn't keep calling a focus
  // function whose textarea no longer exists.
  onMount(() => {
    if (props.onInputReady) {
      props.onInputReady(() => textareaRef?.focus());
      onCleanup(() => props.onInputReady?.(undefined));
    }

    const mq = window.matchMedia?.('(max-width: 767px)');
    if (mq) {
      const update = () => setIsMobile(mq.matches);
      update();
      mq.addEventListener?.('change', update);
      onCleanup(() => mq.removeEventListener?.('change', update));
    }

    onCleanup(() => {
      textareaRef = undefined; // Clear ref on unmount to prevent stale closures
    });
  });

  const addFiles = (files: Iterable<File>) => {
    if (props.attachmentsDisabled) return;
    const accepted = [...files].filter(isAcceptedFile);
    if (accepted.length === 0) return;
    setPendingFiles((prev) => [...prev, ...accepted]);
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFileInputChange = (e: Event) => {
    const inputEl = e.currentTarget as HTMLInputElement;
    if (inputEl.files) addFiles(inputEl.files);
    inputEl.value = '';
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && isAcceptedFile(file)) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const content = input().trim();
    const files = pendingFiles();
    if ((!content && files.length === 0) || props.disabled || isSending())
      return;

    setIsSending(true);
    try {
      await props.onSend(
        content,
        props.selectedAgentId,
        files.length > 0 ? files : undefined,
      );
      setInput('');
      setPendingFiles([]);
    } catch {
      // Send/upload failed (the parent surfaces the error) — keep the input
      // and pending files so the user can retry.
    } finally {
      setIsSending(false);
    }
  };

  const placeholder = () =>
    isQueueing()
      ? 'Queue a follow-up message…'
      : props.placeholder || 'Type a message...';

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const setRef = (el: HTMLTextAreaElement | undefined) => {
    textareaRef = el;
  };

  const inputDisabled = () => props.disabled || isSending();
  const sendDisabled = () =>
    props.disabled ||
    isSending() ||
    (!input().trim() && pendingFiles().length === 0);
  const sendAriaLabel = () => (isQueueing() ? 'Queue message' : 'Send message');
  const sendTitle = () =>
    isQueueing()
      ? 'Agent is responding — your message will be queued'
      : 'Send message';

  // Send-button inner content (spinner while sending, else queue/send icon).
  const sendIcon = () => (
    <Show
      when={isSending()}
      fallback={
        <Show when={isQueueing()} fallback={<Send class="w-4 h-4" />}>
          <ListPlus class="w-4 h-4" />
        </Show>
      }
    >
      <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
    </Show>
  );

  const attachButton = (extraClass: string) => (
    <button
      type="button"
      onClick={() => fileInputRef?.click()}
      disabled={inputDisabled() || props.attachmentsDisabled}
      aria-label="Attach image or audio"
      title={
        props.attachmentsDisabled
          ? 'Attachments are not available in a private chat'
          : 'Attach image or audio'
      }
      class={`flex-shrink-0 flex items-center justify-center rounded-lg text-text-tertiary hover:text-text-primary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${extraClass}`}
    >
      <Paperclip class="w-4 h-4" />
    </button>
  );

  // Pending attachment chips (image thumbnails / audio labels), shown above
  // the input until the message is sent.
  const attachmentChips = () => (
    <Show when={pendingFiles().length > 0}>
      <div class="flex flex-wrap gap-2 mb-2" aria-label="Pending attachments">
        <For each={pendingFiles()}>
          {(file, index) => (
            <div class="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 pl-1.5 pr-1 py-1 text-xs text-text-secondary max-w-48">
              <Show
                when={file.type.startsWith('image/')}
                fallback={<Music class="w-4 h-4 flex-shrink-0" />}
              >
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  class="w-6 h-6 rounded object-cover flex-shrink-0"
                  onLoad={(e) => URL.revokeObjectURL(e.currentTarget.src)}
                />
              </Show>
              <span class="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(index())}
                aria-label={`Remove ${file.name}`}
                class="flex-shrink-0 rounded p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          )}
        </For>
      </div>
    </Show>
  );

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      class={`border-t border-gray-200 dark:border-gray-700 px-3 py-2 md:p-4 ${
        isDragOver() ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      }`}
    >
      <input
        ref={(el) => {
          fileInputRef = el;
        }}
        type="file"
        accept="image/*,audio/*,video/*"
        multiple
        class="hidden"
        onChange={handleFileInputChange}
      />

      {attachmentChips()}

      <Show
        when={isMobile()}
        fallback={
          /* ── Desktop / tablet (≥ md): [picker] [attach] [input] [send] ── */
          <div class="flex items-center gap-3">
            <AgentPicker
              agents={props.agents}
              selectedAgentId={props.selectedAgentId}
              onSelect={props.onAgentSelect}
              disabled={inputDisabled()}
            />

            {attachButton('w-10 h-10')}

            <div class="flex-1">
              <textarea
                ref={setRef}
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={inputDisabled()}
                placeholder={placeholder()}
                rows={1}
                class="w-full resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-2 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed min-h-10 max-h-32 overflow-y-auto mt-1"
              />
            </div>

            <button
              type="submit"
              disabled={sendDisabled()}
              class="flex-shrink-0 w-10 h-10 rounded-lg bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
              aria-label={sendAriaLabel()}
              title={sendTitle()}
            >
              {sendIcon()}
            </button>
          </div>
        }
      >
        {/* ── Mobile (< md): one compact row — agent icon, attach, input, send —
            in a single pill, so the chat scrollback keeps the vertical space.
            The agent is icon-only (its name shows in the picker sheet), and
            the keyboard hint below is hidden. ── */}
        <div class="flex items-end gap-1.5 rounded-2xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-1 focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent">
          <AgentPicker
            variant="icon"
            agents={props.agents}
            selectedAgentId={props.selectedAgentId}
            onSelect={props.onAgentSelect}
            disabled={inputDisabled()}
          />
          {attachButton('w-8 h-8 rounded-full')}
          <textarea
            ref={setRef}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={inputDisabled()}
            placeholder={placeholder()}
            rows={1}
            class="flex-1 min-w-0 resize-none bg-transparent py-1 text-text-primary placeholder-text-tertiary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed min-h-8 max-h-32 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={sendDisabled()}
            class="flex-shrink-0 w-8 h-8 rounded-full bg-primary hover:bg-primary-hover disabled:bg-primary-disabled text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
            aria-label={sendAriaLabel()}
            title={sendTitle()}
          >
            {sendIcon()}
          </button>
        </div>
      </Show>

      {/* Keyboard hint — desktop only; hidden on mobile to maximize chat space. */}
      <p class="mt-2 text-xs text-text-tertiary hidden md:block">
        <Show
          when={isQueueing()}
          fallback="Press Enter to send, Shift+Enter for new line — paste or drop images/audio to attach"
        >
          Agent is responding — Enter queues your message, sent when it finishes
        </Show>
      </p>
    </form>
  );
}
