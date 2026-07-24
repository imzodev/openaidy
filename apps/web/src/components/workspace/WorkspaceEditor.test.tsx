import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@solidjs/testing-library';
import { WorkspaceEditor } from './WorkspaceEditor';
import * as api from '../../lib/api';

vi.mock('./CodeMirrorEditor', () => ({
  CodeMirrorEditor: (props: {
    value: string;
    onChange: (nextValue: string) => void;
    readOnly?: boolean;
  }) => (
    <textarea
      data-testid="mock-codemirror"
      value={props.value}
      onInput={(event) => props.onChange(event.currentTarget.value)}
      readOnly={props.readOnly}
    />
  ),
}));

vi.mock('../../lib/api', () => ({
  readWorkspaceFile: vi.fn(),
  updateWorkspaceFile: vi.fn(),
  downloadWorkspaceFile: vi.fn(),
}));

describe('WorkspaceEditor', () => {
  const file = {
    name: 'test.txt',
    path: 'test.txt',
    isDirectory: false,
    size: 12,
    modifiedAt: '2026-04-05T10:00:00Z',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows empty state when no file is selected', () => {
    render(() => <WorkspaceEditor agentId="default" selectedFile={null} />);

    expect(
      screen.getByText('Select a file from the browser to preview or edit it.'),
    ).toBeInTheDocument();
  });

  it('loads selected file content', async () => {
    vi.mocked(api.readWorkspaceFile).mockResolvedValue({
      content: 'hello world',
      path: 'test.txt',
      isText: true,
      mimeType: 'text/plain',
      size: 11,
      modifiedAt: '2026-04-05T10:00:00Z',
      isTooLarge: false,
    });

    render(() => <WorkspaceEditor agentId="default" selectedFile={file} />);

    await screen.findByDisplayValue('hello world');
    expect(api.readWorkspaceFile).toHaveBeenCalledWith('default', 'test.txt');
  });

  it('tracks dirty state and saves edited content', async () => {
    const onDirtyChange = vi.fn();

    vi.mocked(api.readWorkspaceFile).mockResolvedValue({
      content: 'initial',
      path: 'test.txt',
      isText: true,
      mimeType: 'text/plain',
      size: 7,
      modifiedAt: '2026-04-05T10:00:00Z',
      isTooLarge: false,
    });
    vi.mocked(api.updateWorkspaceFile).mockResolvedValue({
      success: true,
      path: 'test.txt',
    });

    render(() => (
      <WorkspaceEditor
        agentId="default"
        selectedFile={file}
        canWrite={true}
        onDirtyChange={onDirtyChange}
      />
    ));

    const textarea = await screen.findByDisplayValue('initial');
    fireEvent.input(textarea, { target: { value: 'updated' } });

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Save (Ctrl/Cmd+S)'));

    await waitFor(() => {
      expect(api.updateWorkspaceFile).toHaveBeenCalledWith(
        'default',
        'test.txt',
        'updated',
        '2026-04-05T10:00:00Z',
      );
    });

    expect(onDirtyChange).toHaveBeenCalled();
  });

  it('renders read-only mode when write is disabled', async () => {
    vi.mocked(api.readWorkspaceFile).mockResolvedValue({
      content: 'readonly',
      path: 'test.txt',
      isText: true,
      mimeType: 'text/plain',
      size: 8,
      modifiedAt: '2026-04-05T10:00:00Z',
      isTooLarge: false,
    });

    render(() => (
      <WorkspaceEditor agentId="default" selectedFile={file} canWrite={false} />
    ));

    const textarea = await screen.findByDisplayValue('readonly');
    expect(textarea).toHaveAttribute('readonly');
    expect(screen.getByText('Read only')).toBeInTheDocument();
  });

  it('blocks editing for non-text files based on detected type', async () => {
    vi.mocked(api.readWorkspaceFile).mockResolvedValue({
      content: '',
      path: 'test.txt',
      isText: false,
      mimeType: 'application/octet-stream',
      size: 128,
      modifiedAt: '2026-04-05T10:00:00Z',
      isTooLarge: false,
    });

    render(() => (
      <WorkspaceEditor agentId="default" selectedFile={file} canWrite={true} />
    ));

    await screen.findByText('Preview only');
    expect(screen.getByText('Non-text file')).toBeInTheDocument();
    expect(
      screen.getByText('Detected type: application/octet-stream'),
    ).toBeInTheDocument();
    expect(api.updateWorkspaceFile).not.toHaveBeenCalled();
  });

  it('downloads the open file when the Download button is clicked', async () => {
    vi.mocked(api.readWorkspaceFile).mockResolvedValue({
      content: 'hello world',
      path: 'test.txt',
      isText: true,
      mimeType: 'text/plain',
      size: 11,
      modifiedAt: '2026-04-05T10:00:00Z',
      isTooLarge: false,
    });
    vi.mocked(api.downloadWorkspaceFile).mockResolvedValue(undefined);

    render(() => <WorkspaceEditor agentId="default" selectedFile={file} />);

    await screen.findByDisplayValue('hello world');
    fireEvent.click(screen.getByTitle('Download file'));

    expect(api.downloadWorkspaceFile).toHaveBeenCalledWith(
      'default',
      'test.txt',
      'test.txt',
    );
  });

  it('surfaces download errors via the error banner', async () => {
    vi.mocked(api.readWorkspaceFile).mockResolvedValue({
      content: 'hello world',
      path: 'test.txt',
      isText: true,
      mimeType: 'text/plain',
      size: 11,
      modifiedAt: '2026-04-05T10:00:00Z',
      isTooLarge: false,
    });
    vi.mocked(api.downloadWorkspaceFile).mockRejectedValue(
      new Error('File too large'),
    );

    render(() => <WorkspaceEditor agentId="default" selectedFile={file} />);

    await screen.findByDisplayValue('hello world');
    fireEvent.click(screen.getByTitle('Download file'));

    expect(await screen.findByText('File too large')).toBeInTheDocument();
  });
});
