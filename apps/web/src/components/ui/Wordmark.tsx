import { Show, createUniqueId } from 'solid-js';
import type { WordmarkProps, WordmarkSize } from '@aidyagent/shared-types';

const ICON_PX: Record<WordmarkSize, number> = {
  sm: 22,
  md: 28,
  lg: 44,
  xl: 64,
};
const TEXT_CLASS: Record<WordmarkSize, string> = {
  sm: 'text-[15px]',
  md: 'text-lg',
  lg: 'text-[28px]',
  xl: 'text-[40px]',
};

/**
 * Aidy app icon + wordmark. Drawn in SVG/type rather than shipped as a
 * raster so it stays crisp at every size and follows light/dark mode.
 */
export function Wordmark(props: WordmarkProps) {
  const size = () => props.size ?? 'md';
  const gradientId = `aidy-icon-${createUniqueId()}`;

  return (
    <span
      class={`inline-flex items-center gap-2 select-none ${props.class ?? ''}`}
    >
      <svg
        width={ICON_PX[size()]}
        height={ICON_PX[size()]}
        viewBox="0 0 24 24"
        aria-hidden="true"
        class="flex-shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="24"
            y2="24"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stop-color="#0a84ff" />
            <stop offset="0.55" stop-color="#5e5ce6" />
            <stop offset="1" stop-color="#bf5af2" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="5.6" fill={`url(#${gradientId})`} />
        <path
          d="M11 6.2c.55 3.4 2.4 5.25 5.8 5.8-3.4.55-5.25 2.4-5.8 5.8-.55-3.4-2.4-5.25-5.8-5.8 3.4-.55 5.25-2.4 5.8-5.8z"
          fill="#fff"
        />
        <path
          d="M17.4 4.4c.2 1.25.88 1.93 2.1 2.1-1.22.17-1.9.85-2.1 2.1-.2-1.25-.88-1.93-2.1-2.1 1.22-.17 1.9-.85 2.1-2.1z"
          fill="#fff"
          fill-opacity="0.85"
        />
      </svg>
      <Show when={!props.iconOnly}>
        <span class={`wordmark leading-none ${TEXT_CLASS[size()]}`}>Aidy</span>
      </Show>
    </span>
  );
}
