import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@solidjs/testing-library';
import { FileExplorer } from './FileExplorer';
import * as api from '../../lib/api';

// Mock the API functions
vi.mock('../../lib/api', () => ({
  listWorkspaceFiles: vi.fn(),
  writeWorkspaceFile: vi.fn(),
  renameWorkspaceFile: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
}));

describe('FileExplorer', () => {
  const mockFiles = [
    {
      name: 'folder1',
      path: 'folder1',
      isDirectory: true,
      size: 0,
      modifiedAt: '2026-04-04T10:00:00Z',
    },
    {
      name: 'file1.txt',
      path: 'file1.txt',
      isDirectory: false,
      size: 1024,
      modifiedAt: '2026-04-04T11:00:00Z',
    },
    {
      name: 'file2.md',
      path: 'file2.md',
      isDirectory: false,
      size: 2048,
      modifiedAt: '2026-04-04T12:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render loading state initially', () => {
    vi.mocked(api.listWorkspaceFiles).mockImplementation(
      () => new Promise(() => {}),
    ); // Never resolves

    render(() => <FileExplorer agentId="test-agent" />);

    expect(screen.getByText('Loading files...')).toBeInTheDocument();
  });

  it('should fetch and display files', async () => {
    vi.mocked(api.listWorkspaceFiles).mockResolvedValue({
      items: mockFiles,
    });

    render(() => <FileExplorer agentId="test-agent" />);

    // Wait for files to load
    await screen.findByText('folder1');
    expect(screen.getByText('file1.txt')).toBeInTheDocument();
    expect(screen.getByText('file2.md')).toBeInTheDocument();
  });

  it('should display error message on fetch failure', async () => {
    vi.mocked(api.listWorkspaceFiles).mockResolvedValue({
      error: 'Access denied',
      code: 'ACCESS_DENIED',
    });

    render(() => <FileExplorer agentId="test-agent" />);

    await screen.findByText('Access denied');
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('should show empty state when no files', async () => {
    vi.mocked(api.listWorkspaceFiles).mockResolvedValue({
      items: [],
    });

    render(() => <FileExplorer agentId="test-agent" />);

    await screen.findByText('Empty folder');
    expect(screen.getByText('Empty folder')).toBeInTheDocument();
  });

  it('should call onFileSelect when file is clicked', async () => {
    vi.mocked(api.listWorkspaceFiles).mockResolvedValue({
      items: mockFiles,
    });

    const onFileSelect = vi.fn();

    render(() => (
      <FileExplorer agentId="test-agent" onFileSelect={onFileSelect} />
    ));

    await screen.findByText('file1.txt');
    fireEvent.click(screen.getByText('file1.txt'));

    expect(onFileSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'file1.txt',
        isDirectory: false,
      }),
    );
  });

  it('should navigate into directory when clicked', async () => {
    vi.mocked(api.listWorkspaceFiles)
      .mockResolvedValueOnce({ items: mockFiles }) // Initial load
      .mockResolvedValueOnce({ items: [] }); // After navigation

    const onDirectorySelect = vi.fn();

    render(() => (
      <FileExplorer
        agentId="test-agent"
        onDirectorySelect={onDirectorySelect}
      />
    ));

    await screen.findByText('folder1');
    fireEvent.click(screen.getByText('folder1'));

    expect(onDirectorySelect).toHaveBeenCalledWith('folder1');
    expect(api.listWorkspaceFiles).toHaveBeenCalledTimes(2);
    expect(api.listWorkspaceFiles).toHaveBeenNthCalledWith(
      2,
      'test-agent',
      'folder1',
    );
  });

  it('should refresh files when refresh button is clicked', async () => {
    vi.mocked(api.listWorkspaceFiles).mockResolvedValue({
      items: mockFiles,
    });

    render(() => <FileExplorer agentId="test-agent" />);

    await screen.findByText('folder1');
    const refreshButton = screen.getByTitle('Refresh');
    fireEvent.click(refreshButton);

    expect(api.listWorkspaceFiles).toHaveBeenCalledTimes(2);
  });

  it('should create file from toolbar action', async () => {
    vi.mocked(api.listWorkspaceFiles)
      .mockResolvedValueOnce({ items: mockFiles })
      .mockResolvedValueOnce({
        items: [
          ...mockFiles,
          {
            name: 'new.txt',
            path: 'new.txt',
            isDirectory: false,
            size: 0,
            modifiedAt: '2026-04-04T13:00:00Z',
          },
        ],
      });
    vi.mocked(api.writeWorkspaceFile).mockResolvedValue({
      success: true,
      path: 'new.txt',
    });

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('new.txt');

    render(() => <FileExplorer agentId="test-agent" canWrite={true} />);

    await screen.findByText('folder1');
    fireEvent.click(screen.getByTitle('Create file'));

    expect(api.writeWorkspaceFile).toHaveBeenCalledWith(
      'test-agent',
      'new.txt',
      '',
    );

    promptSpy.mockRestore();
  });

  it('should sort directories before files', async () => {
    const unsortedFiles = [
      {
        name: 'z-folder',
        path: 'z-folder',
        isDirectory: true,
        size: 0,
        modifiedAt: '2026-04-04T10:00:00Z',
      },
      {
        name: 'a-file.txt',
        path: 'a-file.txt',
        isDirectory: false,
        size: 100,
        modifiedAt: '2026-04-04T10:00:00Z',
      },
      {
        name: 'a-folder',
        path: 'a-folder',
        isDirectory: true,
        size: 0,
        modifiedAt: '2026-04-04T10:00:00Z',
      },
    ];

    vi.mocked(api.listWorkspaceFiles).mockResolvedValue({
      items: unsortedFiles,
    });

    render(() => <FileExplorer agentId="test-agent" />);

    await screen.findByText('a-folder');

    const items = screen.getAllByRole('listitem');
    // First should be a-folder (directory, alphabetically first)
    // Second should be z-folder (directory, alphabetically second)
    // Third should be a-file.txt (file)
    expect(items[0]).toHaveTextContent('a-folder');
    expect(items[1]).toHaveTextContent('z-folder');
    expect(items[2]).toHaveTextContent('a-file.txt');
  });
});
