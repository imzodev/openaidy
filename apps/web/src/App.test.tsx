import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import App from './App';

describe('App', () => {
  it('renders the starter heading and counter text', () => {
    const container = document.createElement('div');
    document.body.append(container);

    const dispose = render(() => <App />, container);

    expect(container.textContent).toContain('Get started');
    expect(container.textContent).toContain('Count is ');

    dispose();
    container.remove();
  });
});
