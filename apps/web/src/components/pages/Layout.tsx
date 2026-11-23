import type { JSX } from 'solid-js';

type LayoutProps = {
  title: string;
  description?: string;
  children: JSX.Element;
  actions?: JSX.Element;
};

export function Layout(props: LayoutProps) {
  return (
    <div class="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div class="w-full max-w-[1400px] mx-auto pt-6 pb-10 px-4 sm:px-8 animate-rise-in">
        <div class="flex items-end justify-between gap-4 mb-6">
          <div class="min-w-0">
            <h1 class="text-large-title text-text-primary">{props.title}</h1>
            {props.description && (
              <p class="text-[15px] text-text-tertiary mt-1">
                {props.description}
              </p>
            )}
          </div>
          {props.actions && (
            <div class="flex items-center gap-2 flex-shrink-0">
              {props.actions}
            </div>
          )}
        </div>
        {props.children}
      </div>
    </div>
  );
}
