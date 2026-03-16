import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import App from './App';

describe('App', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('Initial Render', () => {
    it('renders the welcome message when no session is selected', () => {
      const dispose = render(() => <App />, container);

      expect(container.textContent).toContain('Welcome to OpenAidy');
      expect(container.textContent).toContain('Select a session');

      dispose();
    });
  });
});
