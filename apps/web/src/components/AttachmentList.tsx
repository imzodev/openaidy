/**
 * AttachmentList
 *
 * Renders a message's image/audio attachments. Bytes are served by the
 * authenticated raw endpoint, so each item fetches through the auth-aware
 * wrapper and renders from an object URL (same pattern as the workspace
 * file preview) — a bare <img src="/api/..."> would miss the Bearer token.
 */

import { createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import { FileWarning, Music } from 'lucide-solid';
import {
  fetchAttachmentObjectUrl,
  type SessionMessageAttachment,
} from '../lib/api';

function AttachmentItem(props: { attachment: SessionMessageAttachment }) {
  const [url, setUrl] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);

  onMount(async () => {
    try {
      setUrl(await fetchAttachmentObjectUrl(props.attachment.id));
    } catch {
      setFailed(true);
    }
  });

  onCleanup(() => {
    const u = url();
    if (u) URL.revokeObjectURL(u);
  });

  const label = () =>
    props.attachment.name ?? `${props.attachment.kind} attachment`;

  return (
    <Show
      when={!failed()}
      fallback={
        <div class="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs text-text-tertiary">
          <FileWarning class="w-4 h-4" />
          <span>{label()} (unavailable)</span>
        </div>
      }
    >
      <Show
        when={props.attachment.kind === 'image'}
        fallback={
          <div class="flex items-center gap-2">
            <Music class="w-4 h-4 text-text-tertiary flex-shrink-0" />
            <Show
              when={url()}
              fallback={
                <span class="text-xs text-text-tertiary">
                  Loading {label()}…
                </span>
              }
            >
              <audio
                controls
                src={url()}
                class="h-9 max-w-full"
                title={label()}
              />
            </Show>
          </div>
        }
      >
        <Show
          when={url()}
          fallback={
            <div class="w-32 h-24 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
          }
        >
          <a
            href={url()}
            target="_blank"
            rel="noopener"
            title={label()}
            class="block"
          >
            <img
              src={url()}
              alt={label()}
              class="max-h-64 max-w-full rounded-lg border border-gray-200 dark:border-gray-700 object-contain"
            />
          </a>
        </Show>
      </Show>
    </Show>
  );
}

export function AttachmentList(props: {
  attachments: SessionMessageAttachment[];
}) {
  return (
    <div class="flex flex-wrap gap-2 mt-2" aria-label="Attachments">
      <For each={props.attachments}>
        {(attachment) => <AttachmentItem attachment={attachment} />}
      </For>
    </div>
  );
}
