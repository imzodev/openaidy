import { createSignal, Show } from 'solid-js';
import { Copy, Check } from 'lucide-solid';

export type CopyButtonProps = {
  text: string;
  /** Optional override for the visible/hidden label announced to assistive tech. */
  label?: string;
  class?: string;
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard not available (insecure context). Fall back to a visible
    // textarea selection so the user can copy manually.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    } finally {
      document.body.removeChild(ta);
    }
    return ok;
  }
}

export function CopyButton(props: CopyButtonProps) {
  const [copied, setCopied] = createSignal(false);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(props.text);
    if (!ok) return;
    setCopied(true);
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => setCopied(false), 2_000);
  };

  const label = () => props.label ?? (copied() ? 'Copied' : 'Copy');

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label()}
      title={label()}
      class={
        'inline-flex items-center justify-center rounded p-1 text-text-tertiary hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/10 transition-colors ' +
        (props.class ?? '')
      }
    >
      <Show when={copied()} fallback={<Copy class="w-3.5 h-3.5" />}>
        <Check class="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
      </Show>
    </button>
  );
}
