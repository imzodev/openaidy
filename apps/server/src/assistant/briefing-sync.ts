import type { OwnerConfig } from '@openaidy/config';
import type { PulseService } from '../pulses/service';

/**
 * Keeps the daily-briefing job in step with `owner.briefing` in the
 * config: created when it's switched on, moved when the time or agent
 * changes, paused when it's switched off. There is at most one.
 */
export async function syncBriefing(
  pulses: PulseService,
  owner: OwnerConfig | undefined,
): Promise<void> {
  const briefing = owner?.briefing;
  const [existing, ...extra] = await pulses.listByKind('briefing');
  for (const duplicate of extra) await pulses.deletePulse(duplicate.id);

  if (!briefing?.enabled) {
    if (existing && existing.status === 'active') {
      await pulses.updatePulse(existing.id, { status: 'paused' });
    }
    return;
  }

  const [hour, minute] = briefing.time.split(':').map(Number);
  const schedule = { daily: { hour: hour ?? 8, minute: minute ?? 0 } };
  const prompt = briefing.instructions?.trim() ?? '';

  if (existing && existing.agentId === briefing.agentId) {
    await pulses.updatePulse(existing.id, {
      prompt,
      schedule,
      status: 'active',
      delivery: { toOwner: true },
    });
    return;
  }
  if (existing) await pulses.deletePulse(existing.id);
  await pulses.createPulse({
    kind: 'briefing',
    name: 'Daily briefing',
    prompt,
    schedule,
    delivery: { toOwner: true },
    ...(briefing.agentId ? { agentId: briefing.agentId } : {}),
  });
}
