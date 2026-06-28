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
      <div class="w-full py-3 px-4 sm:px-6">
        <div class="flex items-center justify-between mb-3">
          <div>
            <h1 class="text-xl font-semibold text-text-primary leading-tight">
              {props.title}
            </h1>
            {props.description && (
              <p class="text-xs text-text-secondary mt-0.5">
                {props.description}
              </p>
            )}
          </div>
          {props.actions && (
            <div class="flex items-center gap-2">{props.actions}</div>
          )}
        </div>
        {props.children}
      </div>
    </div>
  );
}
