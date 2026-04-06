import { describe, it, expect, vi, from 'vitest';
import { TaskModal } from './TaskModal';
import type { Agent } from './AgentSelector';

// Mock agents
const mockAgents: Agent[] = [
  { id: 'agent-1', name: 'Agent 1' },
  { id: 'agent-2', name: 'Agent 2' },
];

describe('TaskModal', () => {
  it('renders when isOpen is true', () => {
    const container = document.createElement('div');
    container.innerHTML = '<div data-testid="modal">Create Task</div>';
    
    const props = {
      isOpen: true,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
      agents: mockAgents,
    };
    
    const result = TaskModal(props);
    expect(container.textContent).toContain('Create Task');
  });

  it('does not render when closed', () => {
    const container = document.createElement('div');
    
    const props = {
      isOpen: false,
      onClose: vi.fn(),
      onSubmit: vi.fn(),
      agents: mockAgents,
    };
    
    const result = TaskModal(props);
    expect(result).toBeUndefined();
  });

  it('calls onClose when cancel clicked', () => {
    const onClose = vi.fn();
    const container = document.createElement('div');
    
    const props = {
      isOpen: true,
      onClose,
      onSubmit: vi.fn(),
      agents: mockAgents,
    };
    
    TaskModal(props);
    container.querySelector<HTMLButtonElement>(e => e.textContent?.includes('Cancel'))?.click();
    
    expect(onClose).toHaveBeenCalled();
  });
});
