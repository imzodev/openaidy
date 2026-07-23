/**
 * Pure helpers for parsing inbound WhatsApp messages.
 *
 * Deliberately free of any Baileys socket dependency so they can be unit
 * tested in isolation. The socket-facing glue (LID→PN resolution, sending
 * replies) lives in service.ts.
 */

/** A subset of a Baileys message key, covering both PN and LID addressing. */
export interface InboundMessageKey {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  participant?: string | null;
  participantAlt?: string | null;
}

/** The message content shapes we can extract text from. */
export interface InboundMessageContent {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  ephemeralMessage?: { message?: InboundMessageContent | null } | null;
  viewOnceMessage?: { message?: InboundMessageContent | null } | null;
  viewOnceMessageV2?: { message?: InboundMessageContent | null } | null;
}

/**
 * Strip the server (`@s.whatsapp.net`, `@lid`, …) and any device suffix
 * (`:12`) from a JID, returning the bare user id (phone number or LID number).
 */
export function bareId(jid: string | null | undefined): string {
  if (!jid) return '';
  return jid.split('@')[0]?.split(':')[0] ?? '';
}

/**
 * Extract the plain-text body of an inbound message, unwrapping the common
 * ephemeral / view-once envelopes WhatsApp uses for disappearing messages.
 * Returns an empty string when the message carries no text (media, reactions,
 * protocol messages, …).
 */
export function extractText(
  message: InboundMessageContent | null | undefined,
): string {
  if (!message) return '';
  const inner =
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message;
  if (inner) return extractText(inner);
  return message.conversation ?? message.extendedTextMessage?.text ?? '';
}

/**
 * Resolve the set of identifiers for an inbound message's sender.
 *
 * WhatsApp addresses a contact either by phone number (PN, `@s.whatsapp.net`)
 * or by Linked Identity (LID, `@lid`). The same sender can appear under either
 * scheme across messages, and the phone-number mapping is not always present on
 * the message key. We therefore collect every id form available — resolving the
 * PN behind a LID when a resolver is supplied — so allowlist checks and session
 * keys match regardless of the scheme WhatsApp chose.
 *
 * - `primary` is the stable id used for the session key. The phone number is
 *   preferred (keeps continuity with pre-LID sessions and phone allowlists),
 *   falling back to the LID, then to whatever id is present.
 * - `candidates` is every bare id the sender might be matched against in an
 *   allowlist.
 */
export async function resolveSenderIds(
  key: InboundMessageKey,
  resolvePnForLid?: (lidJid: string) => Promise<string | null>,
): Promise<{ primary: string; candidates: string[] }> {
  const jids = [
    key.participant,
    key.participantAlt,
    key.remoteJid,
    key.remoteJidAlt,
  ].filter((j): j is string => !!j);

  const pnJid = jids.find((j) => j.endsWith('@s.whatsapp.net'));
  const lidJid = jids.find((j) => j.endsWith('@lid'));

  const candidates = new Set<string>();
  for (const j of jids) {
    const id = bareId(j);
    if (id) candidates.add(id);
  }

  // When only a LID is available, resolve the phone number behind it so that
  // phone-based allowlists (and pre-LID session keys) keep working.
  let resolvedPn = pnJid ? bareId(pnJid) : '';
  if (!resolvedPn && lidJid && resolvePnForLid) {
    try {
      const pn = await resolvePnForLid(lidJid);
      const id = bareId(pn);
      if (id) {
        resolvedPn = id;
        candidates.add(id);
      }
    } catch {
      // Best-effort: fall back to matching on the LID.
    }
  }

  const primary = resolvedPn || bareId(lidJid) || bareId(jids[0]) || '';
  return { primary, candidates: [...candidates] };
}
