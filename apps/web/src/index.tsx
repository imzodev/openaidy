/* @refresh reload */
import { render } from 'solid-js/web';
import './index.css';
import App from './App.tsx';

// ============================================================================
// Addon System Initialization
// ============================================================================

/**
 * Initialize the addon system before app render
 * This sets up error handlers and development mode for addons
 */
async function initializeAddonSystem(): Promise<void> {
  // Set up global error handler for addon errors
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      console.error('[Addon System] Uncaught error:', event.error);
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error(
        '[Addon System] Unhandled promise rejection:',
        event.reason,
      );
    });
  }

  // Development mode configuration
  if (import.meta.env.DEV) {
    console.info('[Addon System] Running in development mode');
  }
}

// Initialize addon system
initializeAddonSystem().catch((err) => {
  console.error('[Addon System] Failed to initialize:', err);
});

// ============================================================================
// Application Bootstrap
// ============================================================================

const root = document.getElementById('root');

render(() => <App />, root!);
