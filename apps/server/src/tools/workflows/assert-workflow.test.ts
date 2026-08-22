import { describe, it, expect } from 'vitest';
import { assertWorkflow } from './assert-workflow';

describe('assertWorkflow', () => {
  it('accepts a task with planningEnabled=true (boolean)', () => {
    const result = assertWorkflow({
      id: 'wf-1',
      planningEnabled: true,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a task with planningEnabled=1 (integer, the SQLite runtime shape)', () => {
    const result = assertWorkflow({
      id: 'wf-1',
      planningEnabled: 1,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a task with planningEnabled=false', () => {
    const result = assertWorkflow({
      id: 'wf-1',
      planningEnabled: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not a workflow/);
  });

  it('rejects a task with planningEnabled=0', () => {
    const result = assertWorkflow({
      id: 'wf-1',
      planningEnabled: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a task with planningEnabled=undefined', () => {
    const result = assertWorkflow({ id: 'wf-1' });
    expect(result.ok).toBe(false);
  });

  it('rejects a null task', () => {
    const result = assertWorkflow(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('Workflow not found');
  });
});
