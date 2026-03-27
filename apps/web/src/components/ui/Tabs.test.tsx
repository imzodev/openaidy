import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@solidjs/testing-library';
import { Tabs, type Tab } from './Tabs';
import { createSignal } from 'solid-js';

type TestTab = 'tab1' | 'tab2' | 'tab3';

describe('Tabs', () => {
  const tabs: Tab<TestTab>[] = [
    { id: 'tab1', label: 'Tab 1' },
    { id: 'tab2', label: 'Tab 2' },
    { id: 'tab3', label: 'Tab 3' },
  ];

  beforeEach(() => {
    cleanup();
  });

  it('should render all tabs', () => {
    const activeTab = () => 'tab1' as TestTab;
    const { container } = render(() => (
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={() => {}} />
    ));

    expect(container).toHaveTextContent('Tab 1');
    expect(container).toHaveTextContent('Tab 2');
    expect(container).toHaveTextContent('Tab 3');
  });

  it('should highlight active tab', () => {
    const activeTab = () => 'tab2' as TestTab;
    const { container } = render(() => (
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={() => {}} />
    ));

    const buttons = container.querySelectorAll('button');
    const tab2Button = Array.from(buttons).find(
      (btn) => btn.textContent === 'Tab 2',
    );
    expect(tab2Button).toHaveClass('border-blue-500');
  });

  it('should call onTabChange when tab is clicked', () => {
    const onTabChange = vi.fn();
    const activeTab = () => 'tab1' as TestTab;
    const { container } = render(() => (
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
    ));

    const buttons = container.querySelectorAll('button');
    const tab2Button = Array.from(buttons).find(
      (btn) => btn.textContent === 'Tab 2',
    );
    fireEvent.click(tab2Button!);
    expect(onTabChange).toHaveBeenCalledWith('tab2');
  });

  it('should update active tab reactively', () => {
    const [activeTab, setActiveTab] = createSignal<TestTab>('tab1');
    const { container } = render(() => (
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
    ));

    const buttons = container.querySelectorAll('button');
    const tab1Button = Array.from(buttons).find(
      (btn) => btn.textContent === 'Tab 1',
    );
    expect(tab1Button).toHaveClass('border-blue-500');

    const tab3Button = Array.from(buttons).find(
      (btn) => btn.textContent === 'Tab 3',
    );
    fireEvent.click(tab3Button!);
    expect(tab3Button).toHaveClass('border-blue-500');
  });
});
