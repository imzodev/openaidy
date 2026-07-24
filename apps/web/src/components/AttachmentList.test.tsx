import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@solidjs/testing-library';
import { AttachmentList } from './AttachmentList';
import * as api from '../lib/api';
import type { SessionMessageAttachment } from '../lib/api';

// Only the object-URL fetch is used by this component; everything else in
// the api module is irrelevant here.
vi.mock('../lib/api', () => ({
  fetchAttachmentObjectUrl: vi.fn(),
}));

function attachment(
  overrides: Partial<SessionMessageAttachment>,
): SessionMessageAttachment {
  return {
    id: overrides.id ?? 'att-1',
    kind: overrides.kind ?? 'image',
    source: overrides.source ?? 'tool_output',
    mimeType: overrides.mimeType ?? 'image/png',
    sizeBytes: overrides.sizeBytes ?? 128,
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
  };
}

// jsdom lacks URL.createObjectURL/revokeObjectURL; the component revokes
// on cleanup, so install a no-op for the test run.
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  if (originalRevoke) {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
  } else {
    delete (URL as unknown as Record<string, unknown>)['revokeObjectURL'];
  }
});

describe('AttachmentList', () => {
  it('renders an image attachment as an <img> inside a link', async () => {
    vi.mocked(api.fetchAttachmentObjectUrl).mockResolvedValue('blob:img');

    const { container } = render(() => (
      <AttachmentList
        attachments={[attachment({ kind: 'image', name: 'chart.png' })]}
      />
    ));

    const img = await screen.findByRole('img', { name: 'chart.png' });
    expect(img).toHaveAttribute('src', 'blob:img');
    expect(container.querySelector('a[href="blob:img"]')).not.toBeNull();
  });

  it('renders an audio attachment as an <audio controls> player', async () => {
    vi.mocked(api.fetchAttachmentObjectUrl).mockResolvedValue('blob:audio');

    const { container } = render(() => (
      <AttachmentList
        attachments={[
          attachment({
            kind: 'audio',
            mimeType: 'audio/mpeg',
            name: 'voice.mp3',
          }),
        ]}
      />
    ));

    await screen.findByTitle('voice.mp3');
    const audio = container.querySelector('audio');
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute('controls');
    expect(audio).toHaveAttribute('src', 'blob:audio');
  });

  it('renders a video attachment as a <video controls> player', async () => {
    vi.mocked(api.fetchAttachmentObjectUrl).mockResolvedValue('blob:video');

    const { container } = render(() => (
      <AttachmentList
        attachments={[
          attachment({
            kind: 'video',
            mimeType: 'video/mp4',
            name: 'demo.mp4',
          }),
        ]}
      />
    ));

    await screen.findByTitle('demo.mp4');
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('src', 'blob:video');
    // Lazy: don't pull the whole file until the user hits play.
    expect(video).toHaveAttribute('preload', 'metadata');
  });

  it('shows an unavailable chip when the bytes fail to load', async () => {
    vi.mocked(api.fetchAttachmentObjectUrl).mockRejectedValue(
      new Error('gone'),
    );

    render(() => (
      <AttachmentList
        attachments={[attachment({ kind: 'video', name: 'lost.mp4' })]}
      />
    ));

    expect(
      await screen.findByText('lost.mp4 (unavailable)'),
    ).toBeInTheDocument();
  });

  it('renders one item per attachment', async () => {
    vi.mocked(api.fetchAttachmentObjectUrl).mockResolvedValue('blob:x');

    const { container } = render(() => (
      <AttachmentList
        attachments={[
          attachment({ id: 'a1', kind: 'image', name: 'one.png' }),
          attachment({
            id: 'a2',
            kind: 'video',
            mimeType: 'video/mp4',
            name: 'two.mp4',
          }),
        ]}
      />
    ));

    await screen.findByRole('img', { name: 'one.png' });
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('video')).not.toBeNull();
    expect(api.fetchAttachmentObjectUrl).toHaveBeenCalledTimes(2);
  });
});
