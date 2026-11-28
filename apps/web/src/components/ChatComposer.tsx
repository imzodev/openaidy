import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { ArrowUp, ListPlus, Paperclip, X, Music } from 'lucide-solid';
import { AgentPicker } from './AgentPicker';
import { ThinkingPicker } from './ThinkingPicker';
import type { ThinkingPickerProps } from '@aidyagent/shared-types';
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
  /**
   * Thinking-effort picker for the current model. Absent when the model has
   * no known thinking control, which hides the picker.
   */
  thinking?: Omit<ThinkingPickerProps, 'variant' | 'disabled'> | undefined;
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
        <Show
          when={isQueueing()}
          fallback={<ArrowUp class="w-[18px] h-[18px]" stroke-width={2.5} />}
        >
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
      class={`flex-shrink-0 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-fill transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${extraClass}`}
    >
      <Paperclip class="w-[18px] h-[18px]" stroke-width={1.75} />
    </button>
  );

  // Pending attachment chips (image thumbnails / audio labels), shown above
  // the input until the message is sent.
  const attachmentChips = () => (
    <Show when={pendingFiles().length > 0}>
      <div
        class="flex flex-wrap gap-2 mb-2 max-w-3xl mx-auto"
        aria-label="Pending attachments"
      >
        <For each={pendingFiles()}>
          {(file, index) => (
            <div class="flex items-center gap-1.5 rounded-full bg-white dark:bg-gray-800 shadow-sm ring-1 ring-black/5 dark:ring-white/10 pl-1 pr-1.5 py-1 text-xs text-text-secondary max-w-48 animate-rise-in">
              <Show
                when={file.type.startsWith('image/')}
                fallback={<Music class="w-4 h-4 flex-shrink-0" />}
              >
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  class="w-6 h-6 rounded-full object-cover flex-shrink-0"
                  onLoad={(e) => URL.revokeObjectURL(e.currentTarget.src)}
                />
              </Show>
              <span class="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(index())}
                aria-label={`Remove ${file.name}`}
                class="flex-shrink-0 rounded-full p-0.5 hover:bg-fill-strong"
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
      class={`px-3 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-6 md:pt-2 md:pb-4 transition-colors ${
        isDragOver()
          ? '[&_[data-composer]]:ring-2 [&_[data-composer]]:ring-blue-500'
          : ''
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
          <div
            data-composer
            class="max-w-3xl mx-auto flex items-end gap-1.5 rounded-[26px] bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black/[0.06] dark:ring-white/10 p-1.5 transition-shadow focus-within:ring-blue-500/50 focus-within:shadow-xl"
          >
            <AgentPicker
              agents={props.agents}
              selectedAgentId={props.selectedAgentId}
              onSelect={props.onAgentSelect}
              disabled={inputDisabled()}
            />

            <Show when={props.thinking}>
              {(thinking) => (
                <ThinkingPicker {...thinking()} disabled={inputDisabled()} />
              )}
            </Show>

            {attachButton('w-9 h-9')}

            <div class="flex-1 min-w-0">
              <textarea
                ref={setRef}
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                disabled={inputDisabled()}
                placeholder={placeholder()}
                rows={1}
                class="block w-full resize-none bg-transparent px-1.5 py-[7px] text-[15px] leading-[22px] text-text-primary placeholder-text-muted focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed min-h-9 max-h-48 overflow-y-auto"
              />
            </div>

            <button
              type="submit"
              disabled={sendDisabled()}
              class="flex-shrink-0 w-9 h-9 rounded-full bg-primary hover:bg-primary-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed shadow-sm disabled:shadow-none"
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
        <div
          data-composer
          class="flex items-end gap-1.5 rounded-[22px] bg-white dark:bg-gray-800 shadow-md ring-1 ring-black/[0.06] dark:ring-white/10 px-1.5 py-1 focus-within:ring-blue-500/50"
        >
          <AgentPicker
            variant="icon"
            agents={props.agents}
            selectedAgentId={props.selectedAgentId}
            onSelect={props.onAgentSelect}
            disabled={inputDisabled()}
          />
          <Show when={props.thinking}>
            {(thinking) => (
              <ThinkingPicker
                {...thinking()}
                variant="icon"
                disabled={inputDisabled()}
              />
            )}
          </Show>
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
            class="flex-1 min-w-0 resize-none bg-transparent py-1 text-[16px] text-text-primary placeholder-text-muted focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed min-h-8 max-h-32 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={sendDisabled()}
            class="flex-shrink-0 w-8 h-8 rounded-full bg-primary hover:bg-primary-hover disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white flex items-center justify-center transition-colors disabled:cursor-not-allowed"
            aria-label={sendAriaLabel()}
            title={sendTitle()}
          >
            {sendIcon()}
          </button>
        </div>
      </Show>

      {/* Keyboard hint — desktop only; hidden on mobile to maximize chat space. */}
      <p class="mt-2 text-[11px] text-text-muted text-center hidden md:block">
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
