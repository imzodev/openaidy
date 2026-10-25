import type { WorkflowTemplate } from '@openaidy/shared-types';
import {
  TELL_OWNER,
  agentInput,
  businessInput,
  channelInput,
  languageInput,
  ownerPhoneInput,
  sendToolRequirement,
} from './shared.js';

/**
 * Every evening: a WhatsApp reminder to everyone with an appointment
 * tomorrow, and a list for you.
 */
export const appointmentRemindersTemplate: WorkflowTemplate = {
  id: 'appointment-reminders',
  version: 1,
  name: 'Appointment reminders',
  description:
    'Every evening reminds tomorrow’s clients on WhatsApp, using the phone numbers in your calendar events.',
  category: 'sales',
  inputs: [
    channelInput,
    ownerPhoneInput,
    businessInput,
    languageInput,
    agentInput,
  ],
  requirements: [
    {
      key: 'google-calendar',
      label: 'Google Calendar connected',
      check: { mcpServerIds: ['google-calendar'] },
    },
    sendToolRequirement,
  ],
  trigger: { kind: 'schedule', schedule: { daily: { hour: 18, minute: 0 } } },
  nodes: [
    {
      key: 'remind',
      title: 'Remind tomorrow’s clients',
      description:
        'Use the Google Calendar tools to list tomorrow’s appointments. For each event with a client phone number ' +
        '(in the title, description or attendee details), send a short, friendly reminder in {{language}} with the time and place ' +
        'using the channel_send tool: channelId "{{channel}}", to the client’s number. About the business: {{business}}\n\n' +
        'List who was reminded and which events had no phone number. End with "sent" if you reminded anyone, otherwise "none".',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'report',
      title: 'Tell you',
      description: `Write a short WhatsApp message in {{language}} with tomorrow’s appointments, who was reminded, and who couldn’t be. ${TELL_OWNER}`,
      kind: 'agent',
      agent: '{{agent}}',
    },
  ],
  edges: [{ from: 'remind', to: 'report', edgeKind: 'dependency' }],
};
