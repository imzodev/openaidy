/**
 * Sample Addon UI Components
 *
 * Reusable React components that addons can use for common UI patterns.
 * These provide a consistent look and feel for addon interfaces.
 */

import { Show, For } from 'solid-js';
import type { JSX } from 'solid-js';

// ============================================================================
// Button Component
// ============================================================================

/**
 * Button variants
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Button sizes
 */
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Button props
 */
export interface ButtonProps {
  /** Button label */
  children: string;
  /** Button variant */
  variant?: ButtonVariant;
  /** Button size */
  size?: ButtonSize;
  /** Whether button is disabled */
  disabled?: boolean;
  /** Whether button is loading */
  loading?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Button type */
  type?: 'button' | 'submit' | 'reset';
}

/**
 * Sample button component
 */
export function Button(props: ButtonProps) {
  const baseClasses =
    'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClasses: Record<ButtonVariant, string> = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500',
    secondary:
      'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500 dark:bg-gray-700 dark:text-gray-100',
    ghost:
      'text-gray-700 hover:bg-gray-100 focus:ring-gray-500 dark:text-gray-300 dark:hover:bg-gray-800',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  };

  const sizeClasses: Record<ButtonSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
      class={`${baseClasses} ${variantClasses[props.variant ?? 'primary']} ${sizeClasses[props.size ?? 'md']}`}
    >
      <Show when={props.loading}>
        <svg
          class="animate-spin -ml-1 mr-2 h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </Show>
      {props.children}
    </button>
  );
}

// ============================================================================
// Card Component
// ============================================================================

/**
 * Card props
 */
export interface CardProps {
  /** Card title */
  title?: string;
  /** Card content */
  children: JSX.Element;
  /** Optional footer */
  footer?: JSX.Element;
  /** CSS class */
  class?: string;
}

/**
 * Sample card component
 */
export function Card(props: CardProps) {
  return (
    <div
      class={`bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 ${props.class ?? ''}`}
    >
      <Show when={props.title}>
        <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {props.title}
          </h3>
        </div>
      </Show>
      <div class="p-4">{props.children}</div>
      <Show when={props.footer}>
        <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-lg">
          {props.footer}
        </div>
      </Show>
    </div>
  );
}

// ============================================================================
// Input Component
// ============================================================================

/**
 * Input props
 */
export interface InputProps {
  /** Input label */
  label?: string;
  /** Input placeholder */
  placeholder?: string;
  /** Input value */
  value?: string;
  /** Input type */
  type?: 'text' | 'email' | 'password' | 'number';
  /** Error message */
  error?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Change handler */
  onChange?: (value: string) => void;
}

/**
 * Sample input component
 */
export function Input(props: InputProps) {
  return (
    <div class="space-y-1">
      <Show when={props.label}>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {props.label}
        </label>
      </Show>
      <input
        type={props.type ?? 'text'}
        value={props.value ?? ''}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onInput={(e) => props.onChange?.(e.currentTarget.value)}
        class={`w-full px-3 py-2 rounded-lg border ${
          props.error
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
            : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
        } dark:bg-gray-800 dark:text-gray-100 disabled:bg-gray-100 disabled:cursor-not-allowed`}
      />
      <Show when={props.error}>
        <p class="text-sm text-red-500">{props.error}</p>
      </Show>
    </div>
  );
}

// ============================================================================
// Select Component
// ============================================================================

/**
 * Select option
 */
export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Select props
 */
export interface SelectProps {
  /** Select label */
  label?: string;
  /** Select options */
  options: SelectOption[];
  /** Selected value */
  value?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Error message */
  error?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Change handler */
  onChange?: (value: string) => void;
}

/**
 * Sample select component
 */
export function Select(props: SelectProps) {
  return (
    <div class="space-y-1">
      <Show when={props.label}>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {props.label}
        </label>
      </Show>
      <select
        value={props.value ?? ''}
        disabled={props.disabled}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
        class={`w-full px-3 py-2 rounded-lg border ${
          props.error
            ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
            : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500'
        } dark:bg-gray-800 dark:text-gray-100 disabled:bg-gray-100`}
      >
        <Show when={props.placeholder}>
          <option value="" disabled>
            {props.placeholder}
          </option>
        </Show>
        <For each={props.options}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
      <Show when={props.error}>
        <p class="text-sm text-red-500">{props.error}</p>
      </Show>
    </div>
  );
}

// ============================================================================
// Loading Spinner
// ============================================================================

/**
 * Spinner size
 */
export type SpinnerSize = 'sm' | 'md' | 'lg';

/**
 * Spinner props
 */
export interface SpinnerProps {
  /** Spinner size */
  size?: SpinnerSize;
  /** CSS class */
  class?: string;
}

/**
 * Loading spinner component
 */
export function Spinner(props: SpinnerProps) {
  const sizeClasses: Record<SpinnerSize, string> = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  return (
    <svg
      class={`animate-spin text-blue-600 ${sizeClasses[props.size ?? 'md']} ${props.class ?? ''}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        class="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        stroke-width="4"
      />
      <path
        class="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// ============================================================================
// Empty State
// ============================================================================

/**
 * Empty state props
 */
export interface EmptyStateProps {
  /** Icon component */
  icon?: JSX.Element;
  /** Title */
  title: string;
  /** Description */
  description?: string;
  /** Action button */
  action?: { label: string; onClick: () => void };
}

/**
 * Empty state component
 */
export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="text-center py-12">
      <Show when={props.icon}>
        <div class="mx-auto h-12 w-12 text-gray-400">{props.icon}</div>
      </Show>
      <h3 class="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {props.title}
      </h3>
      <Show when={props.description}>
        <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {props.description}
        </p>
      </Show>
      <Show when={props.action}>
        <div class="mt-6">
          <Button onClick={props.action!.onClick}>{props.action!.label}</Button>
        </div>
      </Show>
    </div>
  );
}

// ============================================================================
// Data Table
// ============================================================================

/**
 * Table column definition
 */
export interface TableColumn<T> {
  /** Column key */
  key: keyof T | string;
  /** Column header */
  header: string;
  /** Custom renderer */
  render?: (item: T) => JSX.Element;
}

/**
 * Table props
 */
export interface TableProps<T> {
  /** Table columns */
  columns: TableColumn<T>[];
  /** Table data */
  data: T[];
  /** Row key extractor */
  getRowKey: (item: T) => string;
  /** Row click handler */
  onRowClick?: (item: T) => void;
  /** Loading state */
  loading?: boolean;
  /** Empty message */
  emptyMessage?: string;
}

/**
 * Generic data table component
 */
export function Table<T>(props: TableProps<T>) {
  return (
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead class="bg-gray-50 dark:bg-gray-900">
          <tr>
            <For each={props.columns}>
              {(column) => (
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {column.header}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
          <Show when={props.loading}>
            <tr>
              <td colspan={props.columns.length} class="px-4 py-12 text-center">
                <Spinner class="mx-auto" />
              </td>
            </tr>
          </Show>
          <Show when={!props.loading && props.data.length === 0}>
            <tr>
              <td
                colspan={props.columns.length}
                class="px-4 py-12 text-center text-gray-500"
              >
                {props.emptyMessage ?? 'No data available'}
              </td>
            </tr>
          </Show>
          <Show when={!props.loading}>
            <For each={props.data}>
              {(item) => (
                <tr
                  class={
                    props.onRowClick
                      ? 'hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
                      : ''
                  }
                  onClick={() => props.onRowClick?.(item)}
                >
                  <For each={props.columns}>
                    {(column) => (
                      <td class="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                        {column.render
                          ? column.render(item)
                          : String(
                              (item as Record<string, unknown>)[
                                column.key as string
                              ] ?? '',
                            )}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Status Badge
// ============================================================================

/**
 * Status badge variant
 */
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/**
 * Status badge props
 */
export interface BadgeProps {
  /** Badge text */
  children: string;
  /** Badge variant */
  variant?: BadgeVariant;
}

/**
 * Status badge component
 */
export function Badge(props: BadgeProps) {
  const variantClasses: Record<BadgeVariant, string> = {
    success:
      'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    warning:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  };

  return (
    <span
      class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variantClasses[props.variant ?? 'neutral']}`}
    >
      {props.children}
    </span>
  );
}

// ============================================================================
// Toast Notification
// ============================================================================

/**
 * Toast notification type
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/**
 * Toast notification props
 */
export interface ToastProps {
  /** Toast type */
  type: ToastType;
  /** Toast message */
  message: string;
  /** Dismiss handler */
  onDismiss?: () => void;
}

/**
 * Toast notification component
 */
export function Toast(props: ToastProps) {
  const typeClasses: Record<ToastType, string> = {
    success:
      'bg-green-50 border-green-200 text-green-800 dark:bg-green-900 dark:border-green-700 dark:text-green-200',
    error:
      'bg-red-50 border-red-200 text-red-800 dark:bg-red-900 dark:border-red-700 dark:text-red-200',
    warning:
      'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900 dark:border-yellow-700 dark:text-yellow-200',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900 dark:border-blue-700 dark:text-blue-200',
  };

  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  return (
    <div
      class={`flex items-center gap-3 px-4 py-3 rounded-lg border ${typeClasses[props.type]}`}
    >
      <span class="text-lg">{icons[props.type]}</span>
      <p class="flex-1 text-sm">{props.message}</p>
      <Show when={props.onDismiss}>
        <button
          onClick={props.onDismiss}
          class="text-lg opacity-50 hover:opacity-100"
        >
          ✕
        </button>
      </Show>
    </div>
  );
}

// ============================================================================
// Export all components
// ============================================================================

export const SampleComponents = {
  Button,
  Card,
  Input,
  Select,
  Spinner,
  EmptyState,
  Table,
  Badge,
  Toast,
};
