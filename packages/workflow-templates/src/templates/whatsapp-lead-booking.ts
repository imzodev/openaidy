import type { WorkflowTemplate } from '@openaidy/shared-types';
import {
  agentInput,
  businessInput,
  channelInput,
  languageInput,
} from './shared.js';

/**
 * A WhatsApp message from a possible customer → decide whether it's a
 * real lead → offer two appointment slots from the calendar, ask for
 * what's missing, or close politely. The reply goes back to the chat.
 */
export const whatsappLeadBookingTemplate: WorkflowTemplate = {
  id: 'whatsapp-lead-booking',
  version: 1,
  name: 'WhatsApp lead → offer an appointment',
  description:
    'Answers new WhatsApp leads in seconds: qualifies them and offers two free slots from your calendar.',
  category: 'sales',
  inputs: [
    channelInput,
    {
      key: 'keyword',
      label: 'Messages that start with',
      type: 'string',
      default: 'cita',
      help: 'Leads who send this word start the workflow (e.g. from a "Book now" link).',
    },
    businessInput,
    {
      key: 'duration',
      label: 'Appointment length (minutes)',
      type: 'number',
      default: '30',
    },
    languageInput,
    agentInput,
  ],
  requirements: [
    {
      key: 'google-calendar',
      label: 'Google Calendar connected',
      check: { mcpServerIds: ['google-calendar'] },
    },
  ],
  trigger: {
    kind: 'channel_message',
    channel: '{{channel}}',
    match: { type: 'starts_with', value: '{{keyword}}' },
    replyWithResult: true,
    ackText: '👋',
  },
  nodes: [
    {
      key: 'qualify',
      title: 'Qualify the lead',
      description:
        'A possible customer sent the message in the workflow input. About the business: {{business}}\n\n' +
        'Decide: "qualified" if they want something the business offers and could book a meeting or visit; ' +
        '"needs_info" if it is unclear what they want; "not_a_fit" if the business can\'t help. ' +
        'Summarise what they want in one sentence.',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'offer_slots',
      title: 'Offer two slots',
      description:
        'Use the Google Calendar tools to find two free {{duration}}-minute slots in the next three business days, ' +
        'during business hours. Reply with ONLY the WhatsApp message for the customer, in {{language}}: ' +
        'friendly, short, offering both slots and asking which one works.',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'ask_info',
      title: 'Ask what they need',
      description:
        'Reply with ONLY a short, friendly WhatsApp message in {{language}} asking the customer what they need ' +
        'so the business can help (one question at most).',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'close',
      title: 'Close politely',
      description:
        "Reply with ONLY a short, kind WhatsApp message in {{language}} explaining the business can't help with this, " +
        'suggesting where they might look if it is obvious.',
      kind: 'agent',
      agent: '{{agent}}',
    },
  ],
  edges: [
    {
      from: 'qualify',
      to: 'offer_slots',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'qualified',
    },
    {
      from: 'qualify',
      to: 'ask_info',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'needs_info',
    },
    {
      from: 'qualify',
      to: 'close',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'not_a_fit',
    },
  ],
};
