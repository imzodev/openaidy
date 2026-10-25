import type { WorkflowTemplate } from '@openaidy/shared-types';
import {
  TELL_OWNER,
  agentInput,
  channelInput,
  languageInput,
  ownerPhoneInput,
  paymentProviderInput,
  paymentsRequirement,
  sendToolRequirement,
} from './shared.js';

/**
 * Every morning: yesterday's sales, in one WhatsApp message.
 */
export const dailySalesSummaryTemplate: WorkflowTemplate = {
  id: 'daily-sales-summary',
  version: 1,
  name: 'Daily sales summary',
  description:
    'Every morning sends you yesterday’s sales on WhatsApp: totals, top items and anything unusual.',
  category: 'ops',
  inputs: [
    paymentProviderInput,
    channelInput,
    ownerPhoneInput,
    languageInput,
    agentInput,
  ],
  requirements: [paymentsRequirement, sendToolRequirement],
  trigger: { kind: 'schedule', schedule: { daily: { hour: 8, minute: 0 } } },
  nodes: [
    {
      key: 'gather',
      title: 'Gather yesterday’s sales',
      description:
        'Use the {{provider}} tools to get yesterday’s payments: total amount (by currency), number of sales, ' +
        'average sale, refunds, and the top products or customers if available. Compare with the same weekday last week.',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'send',
      title: 'Send the summary',
      description:
        'Write a WhatsApp-friendly summary in {{language}} (5–8 short lines, no tables): totals, change vs last week, ' +
        `refunds, top items, and one thing worth attention if any. ${TELL_OWNER}`,
      kind: 'agent',
      agent: '{{agent}}',
    },
  ],
  edges: [{ from: 'gather', to: 'send', edgeKind: 'dependency' }],
};
