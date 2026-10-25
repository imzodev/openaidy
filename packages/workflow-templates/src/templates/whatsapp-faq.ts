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
 * Customer questions on WhatsApp, answered from what you wrote about your
 * business; anything it can't answer is passed to you.
 */
export const whatsappFaqTemplate: WorkflowTemplate = {
  id: 'whatsapp-faq',
  version: 1,
  name: 'Customer questions on WhatsApp',
  description:
    'Answers customer questions from your business info, and messages you when a person needs to step in.',
  category: 'support',
  inputs: [
    channelInput,
    {
      key: 'keyword',
      label: 'Messages that contain',
      type: 'string',
      default: '?',
      help: 'Messages containing this start the workflow; "?" catches questions.',
    },
    businessInput,
    ownerPhoneInput,
    languageInput,
    agentInput,
  ],
  requirements: [sendToolRequirement],
  trigger: {
    kind: 'channel_message',
    channel: '{{channel}}',
    match: { type: 'contains', value: '{{keyword}}' },
    replyWithResult: true,
    ackText: '…',
  },
  nodes: [
    {
      key: 'answer',
      title: 'Answer',
      description:
        'A customer asked the question in the workflow input. Answer ONLY from this information about the business: {{business}}\n\n' +
        'If it answers the question, reply with ONLY the WhatsApp message for the customer in {{language}} and end with "answered". ' +
        'If it doesn\'t, or the customer is upset or wants a person, end with "escalate".',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'escalate',
      title: 'Pass it to you',
      description:
        `Write the owner a one-line summary of who asked what (include the sender from the workflow input). ${TELL_OWNER} ` +
        'Then reply with ONLY a short WhatsApp message for the customer in {{language}} saying a person will get back to them soon.',
      kind: 'agent',
      agent: '{{agent}}',
    },
  ],
  edges: [
    {
      from: 'answer',
      to: 'escalate',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'escalate',
    },
  ],
};
