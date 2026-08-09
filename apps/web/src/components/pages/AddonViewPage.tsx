import {
  createSignal,
  Show,
  For,
  onCleanup,
  onMount,
  createMemo,
  createEffect,
  on,
} from 'solid-js';
import {
  Puzzle,
  RefreshCw,
  Info,
  X,
  Shield,
  Calendar,
  Tag,
  AlertTriangle,
  Globe,
  Mic,
  Camera,
  CircleStop,
} from 'lucide-solid';
import type { AddonRecord } from '../../lib/api';
import { refreshAddonToken, getAddonAssetToken } from '../../lib/api';
import { resolveToken } from '../../lib/auth-token';
import { useTheme } from '../../lib/theme';
import {
  ADDON_THEME_TOKEN_NAMES,
  type AddonIframeMessage,
  type AddonInitMessage,
  type AddonThemeMessage,
  type AddonThemePayload,
  type SpeechRecognitionCtorLike,
  type SpeechRecognitionLike,
} from '@openaidy/shared-types';

// Defaults to empty string (same-origin). The Vite dev proxy (dev mode)
// and the server's static handler (--integrated mode) both serve addons
// on the same origin the browser is already on, so a relative URL works.
const SERVER_BASE = import.meta.env.OPENAIDY_VITE_SERVER_URL ?? '';

/**
 * Sample the host's resolved theme — the mode the user is actually seeing
 * (after `system` collapses to light/dark) plus the resolved values of every
 * CSS custom property the host uses to drive its palette.
 *
 * Reading `getComputedStyle` is the only portable way to know the *current*
 * values: a custom-theme system, or any future override, would change the
 * variables without us knowing, and we want the addon to track the truth.
 */
function readThemeFromHost(): AddonThemePayload {
  if (typeof document === 'undefined') {
    return { mode: 'dark', tokens: {} };
  }
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const tokens: Record<string, string> = {};
  for (const name of ADDON_THEME_TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  const mode: AddonThemePayload['mode'] = root.classList.contains('dark')
    ? 'dark'
    : 'light';
  return { mode, tokens };
}

type Props = {
  addon: AddonRecord;
};

export function AddonViewPage(props: Props) {
  const { resolvedTheme } = useTheme();
  const manifest = () => props.addon.manifest as Record<string, unknown>;
  const ui = () => manifest().ui as Record<string, unknown> | undefined;
  const sidebar = () => ui()?.sidebar as Record<string, unknown> | undefined;
  const label = () =>
    (sidebar()?.label as string | undefined) ?? props.addon.name;

  const entry = () =>
    (manifest().entry as string | undefined) ?? 'app/index.html';
  // Asset token authenticates the sandboxed iframe's static asset loads.
  const [assetToken, setAssetToken] = createSignal<string | null>(null);
  const iframeSrc = () =>
    `${SERVER_BASE}/addons/${props.addon.addonId}/${entry()}?at=${encodeURIComponent(
      assetToken() ?? '',
    )}`;

  const [loadError, setLoadError] = createSignal(false);
  const [reloading, setReloading] = createSignal(false);
  const [showInfo, setShowInfo] = createSignal(false);
  const [cspWarnings, setCspWarnings] = createSignal<string[]>([]);
  let iframeRef: HTMLIFrameElement | undefined;

  const externalDomains = createMemo(() => {
    const d = manifest().externalDomains;
    return Array.isArray(d) ? (d as string[]) : [];
  });

  // ── Media (microphone / camera) ─────────────────────────────────────────
  // The addon iframe can't call getUserMedia itself — sandbox="allow-scripts
  // allow-forms" (deliberately no allow-same-origin) gives it an opaque
  // origin, and browsers can't persist a mic/camera grant against that. The
  // host captures on the addon's behalf instead, gated by a `media.read` (or
  // `media.read:microphone` / `media.read:camera`) permission, and hands the
  // recording/photo back over the same postMessage bridge.
  const MAX_RECORD_SECONDS = 600;
  const [recordingActive, setRecordingActive] = createSignal(false);
  const [recordingSecondsLeft, setRecordingSecondsLeft] = createSignal(0);
  let stopRecordingFn: (() => void) | null = null;

  const [photoRequestId, setPhotoRequestId] = createSignal<string | null>(null);
  let photoStream: MediaStream | null = null;
  let photoVideoRef: HTMLVideoElement | undefined;

  const hasMediaPermission = (kind: 'microphone' | 'camera'): boolean => {
    const permissions = props.addon.permissions ?? [];
    if (
      permissions.includes('*') ||
      permissions.includes('media.*') ||
      permissions.includes('media.read')
    ) {
      return true;
    }
    return permissions.includes(`media.read:${kind}`);
  };

  const postMediaResult = (
    requestId: string,
    result:
      | { ok: true; data: unknown }
      | { ok: false; status: number; error: string },
  ) => {
    iframeRef?.contentWindow?.postMessage(
      result.ok
        ? {
            type: 'OPENAIDY_RESPONSE',
            requestId,
            ok: true,
            status: 200,
            data: result.data,
          }
        : {
            type: 'OPENAIDY_RESPONSE',
            requestId,
            ok: false,
            status: result.status,
            error: result.error,
          },
      '*',
    );
  };

  const handleRecordAudioRequest = async (
    requestId: string,
    body: { maxSeconds?: number; lang?: string } | undefined,
  ) => {
    if (!hasMediaPermission('microphone')) {
      postMediaResult(requestId, {
        ok: false,
        status: 403,
        error:
          'Missing required permission: media.read or media.read:microphone',
      });
      return;
    }
    if (recordingActive()) {
      postMediaResult(requestId, {
        ok: false,
        status: 409,
        error: 'A recording is already in progress',
      });
      return;
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof MediaRecorder === 'undefined'
    ) {
      postMediaResult(requestId, {
        ok: false,
        status: 501,
        error: 'Microphone recording is not supported in this browser',
      });
      return;
    }

    const maxSeconds = Math.min(
      Math.max(1, Math.floor(body?.maxSeconds ?? 30)),
      MAX_RECORD_SECONDS,
    );

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      postMediaResult(requestId, {
        ok: false,
        status: 403,
        error:
          err instanceof Error
            ? `Microphone access denied: ${err.message}`
            : 'Microphone access denied',
      });
      return;
    }

    const mimeType =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      ) ?? '';
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    const chunks: BlobPart[] = [];
    const startedAt = Date.now();
    let settled = false;
    let timer: ReturnType<typeof setInterval> | undefined = undefined;

    // Best-effort live transcription via the browser's own Web Speech API —
    // a native web API, not an LLM call. Runs alongside MediaRecorder on the
    // same permission grant; the addon gets both the raw audio and (when the
    // browser supports it) a transcript, so an agent asked to structure a
    // voice note only ever has to work with text, never audio understanding.
    const speechWindow = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtorLike;
      webkitSpeechRecognition?: SpeechRecognitionCtorLike;
    };
    const SpeechRecognitionCtor =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    let recognizer: SpeechRecognitionLike | null = null;
    let finalTranscript = '';
    let interimTranscript = '';
    let recognizerEnded = true;
    if (SpeechRecognitionCtor) {
      recognizer = new SpeechRecognitionCtor();
      recognizer.lang = body?.lang || navigator.language || 'en-US';
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.onresult = (event) => {
        interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i]![0]!.transcript;
          if (event.results[i]!.isFinal) finalTranscript += transcript + ' ';
          else interimTranscript += transcript;
        }
      };
      recognizer.onerror = () => {
        // Best-effort — the addon still gets the raw audio either way.
      };
      recognizerEnded = false;
      recognizer.onend = () => {
        recognizerEnded = true;
        tryFinalize();
      };
      try {
        recognizer.start();
      } catch {
        recognizer = null;
        recognizerEnded = true;
      }
    }

    const cleanup = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer) clearInterval(timer);
      stopRecordingFn = null;
      setRecordingActive(false);
    };

    let recorderStopped = false;
    // recorder.onstop and recognizer.onend fire independently — wait for
    // both (recognizer keeps emitting results briefly after .stop()) so the
    // transcript isn't cut off before its last word.
    const tryFinalize = () => {
      if (settled || !recorderStopped || !recognizerEnded) return;
      settled = true;
      // recorder.mimeType (or our own guess) may carry a codec parameter
      // (e.g. "audio/webm;codecs=opus"). Downstream consumers — the
      // attachment upload's mime allowlist in particular — match on the
      // bare type, so strip it before reporting.
      const bareMimeType = (recorder.mimeType || mimeType || 'audio/webm')
        .split(';')[0]!
        .trim();
      const blob = new Blob(chunks, { type: bareMimeType });
      const durationMs = Date.now() - startedAt;
      const transcript = (finalTranscript + ' ' + interimTranscript).trim();
      cleanup();
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        postMediaResult(requestId, {
          ok: true,
          data: {
            data: base64,
            mimeType: blob.type,
            durationMs,
            transcript: transcript || null,
          },
        });
      };
      reader.onerror = () => {
        postMediaResult(requestId, {
          ok: false,
          status: 500,
          error: 'Failed to encode recording',
        });
      };
      reader.readAsDataURL(blob);
    };

    recorder.onstop = () => {
      recorderStopped = true;
      tryFinalize();
      // The recognizer keeps running otherwise — stop it so it doesn't
      // outlive the recording it was transcribing.
      if (recognizer) {
        try {
          recognizer.stop();
        } catch {
          recognizerEnded = true;
          tryFinalize();
        }
      }
    };

    stopRecordingFn = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };

    recorder.start();
    setRecordingActive(true);
    setRecordingSecondsLeft(maxSeconds);
    timer = setInterval(() => {
      setRecordingSecondsLeft((s) => {
        if (s <= 1) {
          stopRecordingFn?.();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const closePhotoCapture = () => {
    photoStream?.getTracks().forEach((t) => t.stop());
    photoStream = null;
    photoVideoRef = undefined;
    setPhotoRequestId(null);
  };

  const handleTakePhotoRequest = async (requestId: string) => {
    if (!hasMediaPermission('camera')) {
      postMediaResult(requestId, {
        ok: false,
        status: 403,
        error: 'Missing required permission: media.read or media.read:camera',
      });
      return;
    }
    if (photoRequestId()) {
      postMediaResult(requestId, {
        ok: false,
        status: 409,
        error: 'A photo capture is already in progress',
      });
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      postMediaResult(requestId, {
        ok: false,
        status: 501,
        error: 'Camera capture is not supported in this browser',
      });
      return;
    }

    try {
      photoStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
    } catch (err) {
      postMediaResult(requestId, {
        ok: false,
        status: 403,
        error:
          err instanceof Error
            ? `Camera access denied: ${err.message}`
            : 'Camera access denied',
      });
      return;
    }

    setPhotoRequestId(requestId);
  };

  const onPhotoVideoMount = (el: HTMLVideoElement) => {
    photoVideoRef = el;
    el.srcObject = photoStream;
    void el.play();
  };

  const capturePhoto = () => {
    const requestId = photoRequestId();
    if (!requestId || !photoVideoRef) return;
    const video = photoVideoRef;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      postMediaResult(requestId, {
        ok: false,
        status: 500,
        error: 'Canvas not supported',
      });
      closePhotoCapture();
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    postMediaResult(requestId, {
      ok: true,
      data: {
        data: base64,
        mimeType: 'image/jpeg',
        width: canvas.width,
        height: canvas.height,
      },
    });
    closePhotoCapture();
  };

  const cancelPhotoCapture = () => {
    const requestId = photoRequestId();
    closePhotoCapture();
    if (requestId) {
      postMediaResult(requestId, {
        ok: false,
        status: 499,
        error: 'User cancelled photo capture',
      });
    }
  };

  // Crypto nonce for secure iframe communication (replaces origin check)
  const nonce = crypto.randomUUID();

  // Fetch the short-lived asset token that authenticates the iframe's static
  // asset loads. The iframe only renders once it's available.
  const loadAssetToken = async () => {
    try {
      const result = await getAddonAssetToken(props.addon.addonId);
      setAssetToken(result.token);
    } catch {
      setLoadError(true);
    }
  };

  // Auto-fetch addon token if missing (e.g. addon was enabled by CLI, not the UI)
  onMount(async () => {
    void loadAssetToken();

    const key = `openaidy_addon_token:${props.addon.addonId}`;
    if (!localStorage.getItem(key)) {
      try {
        const userToken = resolveToken();
        if (!userToken) return;
        const result = await refreshAddonToken(userToken, props.addon.addonId);
        localStorage.setItem(key, result.accessToken);
      } catch {
        // Non-fatal — proxy routes will fail with a clear message if still missing
      }
    }
  });

  const handleReload = () => {
    setLoadError(false);
    setReloading(true);
    // The asset token may have expired since the last load — refresh it.
    void loadAssetToken();
    setTimeout(() => setReloading(false), 50);
  };

  // The iframe never receives the user's auth token — it's a sandboxed,
  // opaque-origin context that can run arbitrary (including LLM-generated)
  // script, so anything posted into it must be assumed readable by the
  // addon itself. All authenticated calls the addon triggers are proxied by
  // this component (see handleMessage below) using a short-lived,
  // addon-scoped token that never crosses into the iframe.
  //
  // The host's current theme (mode + the resolved CSS variable values) is
  // included on init so an addon that mirrors the host's palette is correct
  // on first paint, with no flash. See OPENAIDY_THEME_CHANGED below for the
  // live-update path.
  const sendInit = () => {
    const init: AddonInitMessage = {
      type: 'OPENAIDY_INIT',
      apiBase: SERVER_BASE,
      nonce,
      theme: readThemeFromHost(),
    };
    iframeRef?.contentWindow?.postMessage(init, '*');
  };

  // Live theme propagation. When the user toggles light/dark (or the OS
  // preference changes for `system` mode), the host's `<html>` class flips
  // and the CSS variables resolve to the new palette. We re-sample the host
  // and post OPENAIDY_THEME_CHANGED so a theme-aware addon follows without
  // a reload. The first run is intentionally skipped (`defer: true`) — the
  // initial OPENAIDY_INIT already carries the theme, so we only push deltas.
  createEffect(
    on(
      resolvedTheme,
      () => {
        const message: AddonThemeMessage = {
          type: 'OPENAIDY_THEME_CHANGED',
          theme: readThemeFromHost(),
        };
        iframeRef?.contentWindow?.postMessage(message, '*');
      },
      { defer: true },
    ),
  );

  // Send on iframe load as a fallback for addons that predate ADDON_READY,
  // and again when the addon sends ADDON_READY (see handleMessage) for reliability.
  // Receiving OPENAIDY_INIT twice is safe — the SDK clears callbacks after the first.
  const handleLoad = () => sendInit();

  // Allowlist of paths the addon proxy may forward (method + path regex)
  const ALLOWED_ROUTES: { methods: string[]; pattern: RegExp }[] = [
    {
      methods: ['GET', 'POST', 'DELETE', 'PATCH', 'PUT'],
      pattern: /^\/api\/addon-proxy\//,
    },
  ];

  const isAllowed = (method: string, path: string) =>
    ALLOWED_ROUTES.some(
      (r) => r.methods.includes(method.toUpperCase()) && r.pattern.test(path),
    );

  // Bridge: proxy API requests from the iframe to the real backend
  const handleMessage = async (event: MessageEvent) => {
    // The sandboxed iframe has an opaque origin, so `event.origin` can't be
    // checked. Compare `event.source` — the iframe's actual window object —
    // instead: this rejects messages from any other frame/tab up front, for
    // every message type, including ADDON_READY (which necessarily arrives
    // before the addon has a nonce to echo back).
    if (event.source !== iframeRef?.contentWindow) return;
    const raw = event.data;
    if (typeof raw !== 'object' || raw === null) return;
    const msg = raw as AddonIframeMessage;
    // Addon signals it is ready to receive OPENAIDY_INIT (timing safety)
    if (msg.type === 'ADDON_READY') {
      sendInit();
      return;
    }
    if (msg.type === 'ADDON_CSP_VIOLATION') {
      if (msg.nonce !== nonce) return;
      const blocked = msg.blockedURI;
      try {
        const host = new URL(blocked).hostname;
        setCspWarnings((prev) =>
          prev.includes(host) ? prev : [...prev, host],
        );
      } catch {
        setCspWarnings((prev) =>
          prev.includes(blocked) ? prev : [...prev, blocked],
        );
      }
      return;
    }
    if (msg.type === 'OPENAIDY_MEDIA_STOP') {
      if (msg.nonce !== nonce) return;
      stopRecordingFn?.();
      return;
    }
    if (msg.type !== 'OPENAIDY_REQUEST') return;
    // Validate nonce instead of origin (sandbox strips origin to 'null')
    if (msg.nonce !== nonce) return;

    const { requestId, method, path: reqPath, body } = msg;

    // Media capture is a browser capability, not a backend proxy route — the
    // host handles these virtual paths directly instead of forwarding them.
    if (reqPath === '/media/record-audio') {
      void handleRecordAudioRequest(
        requestId,
        body as { maxSeconds?: number; lang?: string } | undefined,
      );
      return;
    }
    if (reqPath === '/media/take-photo') {
      void handleTakePhotoRequest(requestId);
      return;
    }

    // Reject requests to paths not in the allowlist
    if (!isAllowed(method, reqPath)) {
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: false,
          status: 403,
          error: `Addon proxy: ${method} ${reqPath} is not allowed`,
        },
        '*',
      );
      return;
    }

    // Every allowed path is an addon-proxy route (see ALLOWED_ROUTES above),
    // so this always requires the short-lived, addon-scoped token — never
    // the user's own auth token. Fail closed if it's missing; there is no
    // fallback to a broader credential.
    const addonToken = localStorage.getItem(
      `openaidy_addon_token:${props.addon.addonId}`,
    );

    if (!addonToken) {
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: false,
          status: 401,
          error:
            'Addon token not found. Disable and re-enable the addon to refresh it.',
        },
        '*',
      );
      return;
    }

    try {
      const res = await fetch(`${SERVER_BASE}${reqPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${addonToken}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data: unknown = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : await res.text();
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: res.ok,
          status: res.status,
          data,
        },
        '*',
      );
    } catch (err) {
      iframeRef?.contentWindow?.postMessage(
        {
          type: 'OPENAIDY_RESPONSE',
          requestId,
          ok: false,
          status: 0,
          error: String(err),
        },
        '*',
      );
    }
  };

  window.addEventListener('message', handleMessage);

  onCleanup(() => {
    window.removeEventListener('message', handleMessage);
    stopRecordingFn?.();
    photoStream?.getTracks().forEach((t) => t.stop());
  });

  return (
    <div class="flex flex-col h-full">
      {/* Header bar */}
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
        <div>
          <h1 class="text-base font-semibold text-text-primary">{label()}</h1>
          <p class="text-xs text-text-tertiary">
            Addon · v{props.addon.version}
          </p>
        </div>
        <div class="flex items-center gap-1">
          <button
            onClick={() => setShowInfo(true)}
            class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Addon info"
          >
            <Info class="w-4 h-4" />
          </button>
          <button
            onClick={handleReload}
            class="p-1.5 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Reload"
          >
            <RefreshCw class="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* CSP warning banner */}
      <Show when={cspWarnings().length > 0}>
        <div class="flex items-start gap-2 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <span class="font-medium">CSP bloqueó peticiones a: </span>
            <For each={cspWarnings()}>
              {(host) => (
                <code class="ml-1 px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 font-mono">
                  {host}
                </code>
              )}
            </For>
            <span class="ml-1">
              — agrega <code class="font-mono">externalDomains</code> al{' '}
              <code class="font-mono">addon.json</code> y recarga.
            </span>
          </div>
          <button
            onClick={() => setCspWarnings([])}
            class="flex-shrink-0 text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          >
            ×
          </button>
        </div>
      </Show>

      {/* Recording indicator — mic capture happens here in the host, not
          inside the addon's sandboxed iframe. */}
      <Show when={recordingActive()}>
        <div class="flex items-center justify-between gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs">
          <div class="flex items-center gap-2">
            <span class="relative flex h-2 w-2">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span class="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
            </span>
            <Mic class="w-3.5 h-3.5" />
            <span class="font-medium">
              {label()} is recording audio — {recordingSecondsLeft()}s left
            </span>
          </div>
          <button
            onClick={() => stopRecordingFn?.()}
            class="flex items-center gap-1 px-2 py-1 rounded-md bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 font-medium"
          >
            <CircleStop class="w-3.5 h-3.5" />
            Stop
          </button>
        </div>
      </Show>

      {/* Photo capture modal — camera preview lives in the host too. */}
      <Show when={photoRequestId()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-text-primary flex items-center gap-2">
                <Camera class="w-4 h-4" />
                {label()} wants a photo
              </h2>
              <button
                onClick={cancelPhotoCapture}
                class="p-1 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="p-4">
              <video
                ref={onPhotoVideoMount}
                autoplay
                playsinline
                muted
                class="w-full rounded-lg bg-black aspect-video"
              />
            </div>
            <div class="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={cancelPhotoCapture}
                class="px-3 py-1.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={capturePhoto}
                class="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Capture
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Info modal */}
      <Show when={showInfo()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowInfo(false)}
        >
          <div
            class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 class="text-lg font-semibold text-text-primary">
                Addon Details
              </h2>
              <button
                onClick={() => setShowInfo(false)}
                class="p-1 rounded-lg text-text-tertiary hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
            <div class="px-5 py-4 space-y-4">
              <div>
                <h3 class="text-xl font-bold text-text-primary">
                  {props.addon.name}
                </h3>
                <Show when={props.addon.description}>
                  <p class="text-sm text-text-secondary mt-1">
                    {props.addon.description}
                  </p>
                </Show>
              </div>

              <div class="grid grid-cols-2 gap-3 text-sm">
                <div class="flex items-center gap-2 text-text-secondary">
                  <Tag class="w-3.5 h-3.5" />
                  <span>Version</span>
                </div>
                <span class="text-text-primary font-medium">
                  v{props.addon.version}
                </span>

                <div class="flex items-center gap-2 text-text-secondary">
                  <span class="w-3.5 h-3.5 text-center text-xs">ID</span>
                  <span>Addon ID</span>
                </div>
                <span class="text-text-primary font-mono text-xs">
                  {props.addon.addonId}
                </span>

                <div class="flex items-center gap-2 text-text-secondary">
                  <Calendar class="w-3.5 h-3.5" />
                  <span>Installed</span>
                </div>
                <span class="text-text-primary">
                  {new Date(props.addon.installedAt).toLocaleDateString()}
                </span>

                <div class="flex items-center gap-2 text-text-secondary">
                  <Shield class="w-3.5 h-3.5" />
                  <span>Status</span>
                </div>
                <span
                  class={`font-medium ${
                    props.addon.status === 'enabled'
                      ? 'text-green-600 dark:text-green-400'
                      : props.addon.status === 'error'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-text-tertiary'
                  }`}
                >
                  {props.addon.status.charAt(0).toUpperCase() +
                    props.addon.status.slice(1)}
                </span>
              </div>

              <Show when={(props.addon.permissions ?? []).length > 0}>
                <div>
                  <p class="text-sm font-medium text-text-secondary mb-2">
                    Permissions
                  </p>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={props.addon.permissions}>
                      {(perm) => (
                        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-xs font-mono text-text-secondary">
                          {perm}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <Show when={(props.addon.permissions ?? []).length === 0}>
                <div>
                  <p class="text-sm font-medium text-text-secondary mb-1">
                    Permissions
                  </p>
                  <p class="text-xs text-text-tertiary">
                    No permissions declared
                  </p>
                </div>
              </Show>

              <div>
                <p class="text-sm font-medium text-text-secondary mb-2 flex items-center gap-1.5">
                  <Globe class="w-3.5 h-3.5" />
                  External Domains
                </p>
                <Show when={externalDomains().length > 0}>
                  <div class="flex flex-wrap gap-1.5">
                    <For each={externalDomains()}>
                      {(domain) => (
                        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-xs font-mono text-blue-700 dark:text-blue-300">
                          {domain}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={externalDomains().length === 0}>
                  <p class="text-xs text-text-tertiary">
                    None declared — fetch() to external URLs will be blocked by
                    CSP.
                  </p>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Error state */}
      <Show when={loadError()}>
        <div class="flex flex-col items-center justify-center flex-1 text-center p-8">
          <Puzzle class="w-10 h-10 text-text-tertiary mb-3" />
          <p class="text-text-secondary font-medium mb-1">
            Could not load addon UI
          </p>
          <p class="text-sm text-text-tertiary max-w-sm">
            Make sure the addon files exist at{' '}
            <code class="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">
              .openaidy/addons/{props.addon.addonId}/
            </code>
          </p>
        </div>
      </Show>

      {/* Addon iframe — sandbox blocks localStorage/cookie access from addon.
          Gated on the asset token so the iframe URL always carries it. */}
      <Show when={!loadError() && !reloading() && assetToken()}>
        <iframe
          ref={iframeRef}
          src={iframeSrc()}
          class="flex-1 w-full border-0"
          title={label()}
          onLoad={handleLoad}
          onError={() => setLoadError(true)}
          sandbox="allow-scripts allow-forms"
        />
      </Show>
    </div>
  );
}
