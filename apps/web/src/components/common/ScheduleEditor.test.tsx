/**
 * ScheduleEditor component tests.
 *
 * The component now works with the public `ScheduleInput` discriminated
 * union (no `kind` tag — discrimination is by key presence). The tests
 * verify that:
 * - all four kinds are reachable
 * - the value emitted is a canonical `ScheduleInput` (e.g. `{every: '6h'}`
 *   not `{kind: 'every', every: '6h'}`)
 * - the validate hook is called with the canonical value
 * - at-kind with empty date does not emit a value
 */

import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScheduleEditor } from './ScheduleEditor';
import type { ScheduleInput } from '../../lib/types';

// Local cleanup — the global setup.test.ts intentionally does not
// register a global afterEach to avoid interfering with
// resources that take a tick to resolve (see TaskExecutionsPage).
afterEach(() => {
  cleanup();
});

describe('ScheduleEditor', () => {
  it('renders the type selector with all four kinds', () => {
    const onChange = vi.fn();
    render(() => <ScheduleEditor value={null} onChange={onChange} />);

    expect(screen.getByText('Interval')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('Cron')).toBeInTheDocument();
    expect(screen.getByText('One-time')).toBeInTheDocument();
  });

  it('starts with the kind inferred from the provided value (daily)', () => {
    const onChange = vi.fn();
    const value: ScheduleInput = { daily: { hour: 14, minute: 30 } };
    render(() => <ScheduleEditor value={value} onChange={onChange} />);

    // Daily kind has two selects (hour + minute). Verify by role.
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBe(2);
  });

  it('starts with the kind inferred from the provided value (cron)', () => {
    const onChange = vi.fn();
    const value: ScheduleInput = { cron: '0 9 * * *' };
    render(() => <ScheduleEditor value={value} onChange={onChange} />);

    expect(screen.getByPlaceholderText('0 * * * *')).toBeInTheDocument();
  });

  it('switches input UI when kind button is clicked', () => {
    const onChange = vi.fn();
    render(() => <ScheduleEditor value={null} onChange={onChange} />);

    // Initial kind is 'every', so the interval select should be visible.
    const intervalSelect = screen.getByRole('combobox');
    expect(intervalSelect).toBeInTheDocument();

    // Click Cron kind button.
    fireEvent.click(screen.getByText('Cron'));

    // Now the cron input should be visible.
    expect(screen.getByPlaceholderText('0 * * * *')).toBeInTheDocument();
  });

  it('emits the canonical ScheduleInput when the interval select changes', () => {
    const onChange = vi.fn();
    render(() => (
      <ScheduleEditor value={{ every: '1h' }} onChange={onChange} />
    ));

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '6h' } });

    // The onChange is called with the canonical {every: '6h'} — no
    // `kind` tag, no extra wrapper.
    const calls: ScheduleInput[] = onChange.mock.calls.map(
      (c) => c[0] as ScheduleInput,
    );
    expect(calls).toContainEqual({ every: '6h' });
  });

  it('emits the canonical daily ScheduleInput when the hour changes', () => {
    const onChange = vi.fn();
    render(() => (
      <ScheduleEditor
        value={{ daily: { hour: 9, minute: 0 } }}
        onChange={onChange}
      />
    ));

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    // First combobox is the hour select.
    fireEvent.change(selects[0]!, { target: { value: '14' } });

    const calls: ScheduleInput[] = onChange.mock.calls.map(
      (c) => c[0] as ScheduleInput,
    );
    expect(calls).toContainEqual({ daily: { hour: 14, minute: 0 } });
  });

  it('emits the canonical cron ScheduleInput when the expression changes', () => {
    const onChange = vi.fn();
    render(() => (
      <ScheduleEditor value={{ cron: '0 * * * *' }} onChange={onChange} />
    ));

    const input = screen.getByPlaceholderText('0 * * * *') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '0 6 * * 1-5' } });

    const calls: ScheduleInput[] = onChange.mock.calls.map(
      (c) => c[0] as ScheduleInput,
    );
    // tz is undefined here (no previous tz was set), so the canonical
    // shape is {cron: '0 6 * * 1-5'} with no `tz` key.
    expect(calls).toContainEqual({ cron: '0 6 * * 1-5' });
  });

  it('preserves the tz when present in the previous value', () => {
    const onChange = vi.fn();
    const value: ScheduleInput = {
      cron: '0 * * * *',
      tz: 'America/Mexico_City',
    };
    render(() => <ScheduleEditor value={value} onChange={onChange} />);

    const input = screen.getByPlaceholderText('0 * * * *') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '0 6 * * 1-5' } });

    const calls: ScheduleInput[] = onChange.mock.calls.map(
      (c) => c[0] as ScheduleInput,
    );
    expect(calls).toContainEqual({
      cron: '0 6 * * 1-5',
      tz: 'America/Mexico_City',
    });
  });

  it('emits the canonical at ScheduleInput when the datetime changes', () => {
    const onChange = vi.fn();
    render(() => (
      <ScheduleEditor value={{ at: '2026-01-01T00:00' }} onChange={onChange} />
    ));

    const input = screen.getByDisplayValue(
      '2026-01-01T00:00',
    ) as HTMLInputElement;
    fireEvent.input(input, { target: { value: '2026-06-15T09:00' } });

    const calls: ScheduleInput[] = onChange.mock.calls.map(
      (c) => c[0] as ScheduleInput,
    );
    expect(calls).toContainEqual({ at: '2026-06-15T09:00' });
  });

  it('does not call validate when the value is null (at with empty date)', () => {
    const onChange = vi.fn();
    const validate = vi.fn().mockReturnValue(null);
    render(() => (
      <ScheduleEditor value={null} onChange={onChange} validate={validate} />
    ));

    // Switch to One-time.
    fireEvent.click(screen.getByText('One-time'));

    // The kind-switch emits nothing (buildValue returns null because
    // the atDate is empty). The validate hook should not be called.
    expect(validate).not.toHaveBeenCalled();
  });

  it('does not emit an at-value with empty date', () => {
    const onChange = vi.fn();
    render(() => <ScheduleEditor value={null} onChange={onChange} />);

    fireEvent.click(screen.getByText('One-time'));

    // The buildValue returns null for at with empty date, so the
    // kind-switch's emit is skipped. No `at`-shaped call should land.
    const atCalls = onChange.mock.calls.filter(
      (c) => c[0] && typeof c[0] === 'object' && 'at' in (c[0] as object),
    );
    expect(atCalls.length).toBe(0);
  });

  it('does not render validation error when validate returns null', () => {
    const onChange = vi.fn();
    const validate = vi.fn().mockReturnValue(null);
    render(() => (
      <ScheduleEditor
        value={{ cron: '0 * * * *' }}
        onChange={onChange}
        validate={validate}
      />
    ));

    const input = screen.getByPlaceholderText('0 * * * *') as HTMLInputElement;
    fireEvent.input(input, { target: { value: '0 6 * * 1-5' } });

    expect(validate).toHaveBeenCalled();
    expect(
      screen.queryByText('Invalid cron expression'),
    ).not.toBeInTheDocument();
  });

  it('renders a validation error message when validate returns a string', () => {
    const onChange = vi.fn();
    const validate = vi.fn().mockReturnValue('Invalid cron expression');
    render(() => (
      <ScheduleEditor
        value={{ cron: '0 * * * *' }}
        onChange={onChange}
        validate={validate}
      />
    ));

    const input = screen.getByPlaceholderText('0 * * * *') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'totally bogus' } });

    expect(screen.getByText('Invalid cron expression')).toBeInTheDocument();
    // onChange should NOT have been called because validate failed.
    expect(onChange).not.toHaveBeenCalled();
  });
});
