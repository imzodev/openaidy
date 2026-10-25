import type { WorkflowTemplate } from '@openaidy/shared-types';
import {
  TELL_OWNER,
  agentInput,
  channelInput,
  languageInput,
  ownerPhoneInput,
  sendToolRequirement,
} from './shared.js';

/**
 * Every hour: sort new email and leave reply drafts in Gmail. Nothing is
 * sent; you review the drafts and get a WhatsApp nudge when there are any.
 */
export const inboxTriageTemplate: WorkflowTemplate = {
  id: 'inbox-triage',
  version: 1,
  name: 'Inbox triage + reply drafts',
  description:
    'Every hour sorts new email, writes reply drafts in Gmail (never sends), and tells you on WhatsApp what needs you.',
  category: 'ops',
  inputs: [
    {
      key: 'instructions',
      label: 'How to handle email',
      type: 'text',
      default:
        'Draft replies to customers and suppliers. Ignore newsletters, receipts and notifications.',
    },
    channelInput,
    ownerPhoneInput,
    languageInput,
    agentInput,
  ],
  requirements: [
    {
      key: 'gmail',
      label: 'Gmail connected',
      check: { mcpServerIds: ['gmail'] },
    },
    sendToolRequirement,
  ],
  trigger: { kind: 'schedule', schedule: { every: '1h' } },
  nodes: [
    {
      key: 'triage',
      title: 'Sort and draft',
      description:
        'Use the Gmail tools to read unread email from the last hour. {{instructions}}\n\n' +
        'For each email that needs a reply, create a Gmail draft reply (do NOT send). ' +
        'List each email as: sender — subject — what you did. End with "drafts" if you created any, otherwise "nothing".',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'notify',
      title: 'Tell you',
      description: `Write a short WhatsApp message in {{language}} saying how many reply drafts are waiting in Gmail and for whom. ${TELL_OWNER}`,
      kind: 'agent',
      agent: '{{agent}}',
    },
  ],
  edges: [
    {
      from: 'triage',
      to: 'notify',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'drafts',
    },
  ],
};
