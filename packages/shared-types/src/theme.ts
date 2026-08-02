/**
 * Host theme preference. Tri-state: the user can pick `light` or `dark`
 * explicitly, or let the host follow the OS preference (`system`). The
 * resolved mode (the one the user actually sees) is computed elsewhere
 * and surfaced separately — this type is the user-facing preference.
 */
export type Theme = 'light' | 'dark' | 'system';
