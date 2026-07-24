/**
 * AttachmentList
 *
 * Renders a message's media attachments (image, audio, video). Bytes are
 * served by the authenticated raw endpoint, so each item fetches through
 * the auth-aware wrapper and renders from an object URL (same pattern as
 * the workspace file preview) — a bare <img src="/api/..."> would miss
 * the Bearer token.
 */

import {
  createSignal,
  onCleanup,
  onMount,
  Show,
  For,
  Switch,
  Match,
} from 'solid-js';
import { FileWarning, Music } from 'lucide-solid';
import {
  fetchAttachmentObjectUrl,
  type SessionMessageAttachment,
} from '../lib/api';

/** Display label for an attachment: its name, or a kind-based fallback. */
function attachmentLabel(attachment: SessionMessageAttachment): string {
  return attachment.name ?? `${attachment.kind} attachment`;
}

/**
 * Fetches an attachment's bytes into an object URL, revoked on cleanup.
 * Shared by every kind renderer so the fetch/revoke dance lives in one
 * place.
 */
function useAttachmentUrl(attachmentId: string) {
  const [url, setUrl] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);

  onMount(async () => {
    try {
      setUrl(await fetchAttachmentObjectUrl(attachmentId));
    } catch {
      setFailed(true);
    }
  });

  onCleanup(() => {
    const u = url();
    if (u) URL.revokeObjectURL(u);
  });

  return { url, failed };
}

function ImageAttachment(props: {
  attachment: SessionMessageAttachment;
  url?: string;
}) {
  const label = () => attachmentLabel(props.attachment);
  return (
    <Show
      when={props.url}
      fallback={
        <div class="w-32 h-24 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
      }
    >
      {(u) => (
        <a
          href={u()}
          target="_blank"
          rel="noopener"
          title={label()}
          class="block"
        >
          <img
            src={u()}
            alt={label()}
            class="max-h-64 max-w-full rounded-lg border border-gray-200 dark:border-gray-700 object-contain"
          />
        </a>
      )}
    </Show>
  );
}

function AudioAttachment(props: {
  attachment: SessionMessageAttachment;
  url?: string;
}) {
  const label = () => attachmentLabel(props.attachment);
  return (
    <div class="flex items-center gap-2">
      <Music class="w-4 h-4 text-text-tertiary flex-shrink-0" />
      <Show
        when={props.url}
        fallback={
          <span class="text-xs text-text-tertiary">Loading {label()}…</span>
        }
      >
        {(u) => (
          <audio controls src={u()} class="h-9 max-w-full" title={label()} />
        )}
      </Show>
    </div>
  );
}

function VideoAttachment(props: {
  attachment: SessionMessageAttachment;
  url?: string;
}) {
  const label = () => attachmentLabel(props.attachment);
  return (
    <Show
      when={props.url}
      fallback={
        <div class="w-64 h-36 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
      }
    >
      {(u) => (
        // preload="metadata" — don't pull the whole file until the user
        // hits play; shared videos can be tens of MB.
        <video
          controls
          preload="metadata"
          src={u()}
          title={label()}
          class="max-h-64 max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
        />
      )}
    </Show>
  );
}

function AttachmentItem(props: { attachment: SessionMessageAttachment }) {
  const { url, failed } = useAttachmentUrl(props.attachment.id);

  return (
    <Show
      when={!failed()}
      fallback={
        <div class="flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs text-text-tertiary">
          <FileWarning class="w-4 h-4" />
          <span>{attachmentLabel(props.attachment)} (unavailable)</span>
        </div>
      }
    >
      <Switch>
        <Match when={props.attachment.kind === 'image'}>
          <ImageAttachment attachment={props.attachment} url={url()} />
        </Match>
        <Match when={props.attachment.kind === 'audio'}>
          <AudioAttachment attachment={props.attachment} url={url()} />
        </Match>
        <Match when={props.attachment.kind === 'video'}>
          <VideoAttachment attachment={props.attachment} url={url()} />
        </Match>
      </Switch>
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
