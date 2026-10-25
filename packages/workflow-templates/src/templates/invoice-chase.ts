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
 * Every morning: find overdue invoices, draft reminders, and send them
 * once you approve.
 */
export const invoiceChaseTemplate: WorkflowTemplate = {
  id: 'invoice-chase',
  version: 1,
  name: 'Chase overdue invoices',
  description:
    'Each morning finds unpaid invoices, drafts polite reminders for your approval, then sends them.',
  category: 'finance',
  inputs: [
    paymentProviderInput,
    {
      key: 'days',
      label: 'Remind after (days overdue)',
      type: 'number',
      default: '7',
    },
    channelInput,
    ownerPhoneInput,
    languageInput,
    agentInput,
  ],
  requirements: [paymentsRequirement, sendToolRequirement],
  trigger: { kind: 'schedule', schedule: { daily: { hour: 9, minute: 0 } } },
  nodes: [
    {
      key: 'find',
      title: 'Find overdue invoices',
      description:
        'Use the {{provider}} tools to list invoices that are unpaid and at least {{days}} days past due: ' +
        'customer, amount, currency, due date, and the invoice link. End with "found" if there are any, otherwise "none".',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'draft',
      title: 'Draft reminders',
      description:
        'For each overdue invoice, draft a short, polite payment reminder in {{language}} with the amount, due date and payment link. ' +
        `Then send the owner the list of reminders and ask them to approve them in OpenAidy. ${TELL_OWNER}`,
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'approve',
      title: 'Approve reminders',
      description: 'Check the drafted reminders before they go to customers.',
      kind: 'approval_gate',
    },
    {
      key: 'send',
      title: 'Send reminders',
      description:
        'Send each approved reminder using the {{provider}} tools (e.g. resend the invoice email with the reminder). ' +
        'Skip any the approval note says to skip. List what was sent.',
      kind: 'agent',
      agent: '{{agent}}',
    },
  ],
  edges: [
    {
      from: 'find',
      to: 'draft',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'found',
    },
    { from: 'draft', to: 'approve', edgeKind: 'dependency' },
    {
      from: 'approve',
      to: 'send',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'approved',
    },
  ],
};
