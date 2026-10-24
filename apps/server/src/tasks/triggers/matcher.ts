import type {
  ChannelMessageTriggerConfig,
  MessageMatchType,
} from '@openaidy/shared-types';

/**
 * Whether a channel message starts a workflow, per the trigger's match
 * rule. Matching ignores case and surrounding spaces; an invalid regex
 * never matches (it's rejected when the trigger is saved).
 */
export function messageMatches(
  match: ChannelMessageTriggerConfig['match'],
  text: string,
): boolean {
  const message = text.trim().toLowerCase();
  const value = (match.value ?? '').trim().toLowerCase();
  switch (match.type) {
    case 'any':
      return true;
    case 'equals':
      return message === value;
    case 'starts_with':
      return value !== '' && message.startsWith(value);
    case 'contains':
      return value !== '' && message.includes(value);
    case 'regex':
      try {
        return new RegExp(match.value ?? '', 'i').test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Whether the sender is allowed by the trigger's own sender list. */
export function senderAllowed(
  senders: string[] | undefined,
  senderIds: string[],
): boolean {
  if (!senders?.length) return true;
  const normalise = (id: string) => id.replace(/[^\w@.]/g, '').toLowerCase();
  const allowed = new Set(senders.map(normalise));
  return senderIds.some((id) => {
    const n = normalise(id);
    // WhatsApp ids look like 5215550001111@s.whatsapp.net; people type
    // the phone number, so compare the part before "@" too.
    return allowed.has(n) || allowed.has(n.split('@')[0]!);
  });
}

/** Problem with a match rule, or null when it's usable. */
export function matchRuleProblem(match: {
  type: string;
  value?: string | undefined;
}): string | null {
  const types: MessageMatchType[] = [
    'any',
    'equals',
    'starts_with',
    'contains',
    'regex',
  ];
  if (!types.includes(match.type as MessageMatchType)) {
    return `Match type must be one of: ${types.join(', ')}`;
  }
  if (match.type === 'any') return null;
  if (!match.value?.trim()) {
    return 'The match needs a value (the word or text to look for).';
  }
  if (match.type === 'regex') {
    try {
      new RegExp(match.value, 'i');
    } catch (err) {
      return `The match is not a valid regular expression (${err instanceof Error ? err.message : 'invalid'}).`;
    }
  }
  return null;
}
