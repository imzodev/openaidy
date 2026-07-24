import { describe, it, expect } from 'vitest';
import { AGENT_PERSONALITY_PRESETS } from './personality-preset.js';

const VALID_FILE_IDS = new Set(['USER', 'AGENT', 'MISSION', 'RULES']);

describe('AGENT_PERSONALITY_PRESETS', () => {
  it('ships at least a few personalities', () => {
    expect(AGENT_PERSONALITY_PRESETS.length).toBeGreaterThanOrEqual(3);
  });

  it('has unique, non-empty ids', () => {
    const ids = AGENT_PERSONALITY_PRESETS.map((p) => p.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each preset has the required display + prompt fields', () => {
    for (const p of AGENT_PERSONALITY_PRESETS) {
      expect(p.name.trim().length, `${p.id} name`).toBeGreaterThan(0);
      expect(
        p.description.trim().length,
        `${p.id} description`,
      ).toBeGreaterThan(0);
      expect(p.icon.trim().length, `${p.id} icon`).toBeGreaterThan(0);
      expect(
        p.systemPrompt.trim().length,
        `${p.id} systemPrompt`,
      ).toBeGreaterThan(0);
    }
  });

  it('only references valid personality file ids with non-empty bodies', () => {
    for (const p of AGENT_PERSONALITY_PRESETS) {
      for (const [fileId, body] of Object.entries(p.files ?? {})) {
        expect(VALID_FILE_IDS.has(fileId), `${p.id} file ${fileId}`).toBe(true);
        expect(
          (body ?? '').trim().length,
          `${p.id} file ${fileId} body`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
