import { describe, it, expect } from 'vitest';
import { kindForMimeType, mimeTypeForPath } from './service';

describe('kindForMimeType', () => {
  it('classifies images', () => {
    expect(kindForMimeType('image/png')).toBe('image');
    expect(kindForMimeType('image/jpeg')).toBe('image');
    expect(kindForMimeType('image/gif')).toBe('image');
    expect(kindForMimeType('image/webp')).toBe('image');
  });

  it('classifies audio', () => {
    expect(kindForMimeType('audio/mpeg')).toBe('audio');
    expect(kindForMimeType('audio/wav')).toBe('audio');
    expect(kindForMimeType('audio/ogg')).toBe('audio');
    expect(kindForMimeType('audio/flac')).toBe('audio');
  });

  it('classifies video', () => {
    expect(kindForMimeType('video/mp4')).toBe('video');
    expect(kindForMimeType('video/webm')).toBe('video');
    expect(kindForMimeType('video/ogg')).toBe('video');
  });

  it('returns null for unsupported types', () => {
    expect(kindForMimeType('text/plain')).toBeNull();
    expect(kindForMimeType('application/pdf')).toBeNull();
    expect(kindForMimeType('video/quicktime')).toBeNull();
  });
});

describe('mimeTypeForPath', () => {
  it('maps media extensions to mime types', () => {
    expect(mimeTypeForPath('media/chart.png')).toBe('image/png');
    expect(mimeTypeForPath('photo.jpg')).toBe('image/jpeg');
    expect(mimeTypeForPath('voice-note.mp3')).toBe('audio/mpeg');
    expect(mimeTypeForPath('song.m4a')).toBe('audio/mp4');
    expect(mimeTypeForPath('clip.mp4')).toBe('video/mp4');
    expect(mimeTypeForPath('reel.webm')).toBe('video/webm');
    expect(mimeTypeForPath('movie.ogv')).toBe('video/ogg');
  });

  it('is case-insensitive', () => {
    expect(mimeTypeForPath('CLIP.MP4')).toBe('video/mp4');
    expect(mimeTypeForPath('Pic.JPG')).toBe('image/jpeg');
  });

  it('returns null for unsupported or extensionless paths', () => {
    expect(mimeTypeForPath('notes.txt')).toBeNull();
    expect(mimeTypeForPath('archive.zip')).toBeNull();
    expect(mimeTypeForPath('README')).toBeNull();
  });
});
