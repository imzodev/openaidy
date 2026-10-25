import type { WorkflowTemplate } from '@openaidy/shared-types';
import {
  agentInput,
  businessInput,
  channelInput,
  languageInput,
} from './shared.js';

/**
 * Send "post: <idea>" on WhatsApp → a drafted post → you approve → it's
 * scheduled in Buffer. The outcome comes back to your chat.
 */
export const socialPostApprovalTemplate: WorkflowTemplate = {
  id: 'social-post-approval',
  version: 1,
  name: 'Social post from a WhatsApp idea',
  description:
    'Message an idea on WhatsApp; it drafts the post, waits for your approval, then queues it in Buffer.',
  category: 'marketing',
  inputs: [
    channelInput,
    {
      key: 'keyword',
      label: 'Messages that start with',
      type: 'string',
      default: 'post',
    },
    businessInput,
    {
      key: 'tone',
      label: 'Tone',
      type: 'select',
      default: 'friendly',
      options: [
        { value: 'friendly', label: 'Friendly' },
        { value: 'professional', label: 'Professional' },
        { value: 'playful', label: 'Playful' },
      ],
    },
    languageInput,
    agentInput,
  ],
  requirements: [
    {
      key: 'buffer',
      label: 'Buffer connected',
      check: { mcpServerIds: ['buffer'] },
    },
  ],
  trigger: {
    kind: 'channel_message',
    channel: '{{channel}}',
    match: { type: 'starts_with', value: '{{keyword}}' },
    replyWithResult: true,
    ackText: 'Drafting it — approve it in OpenAidy when it’s ready.',
  },
  nodes: [
    {
      key: 'draft',
      title: 'Draft the post',
      description:
        'The idea is in the workflow input. About the business: {{business}}\n\n' +
        'Write one social media post in {{language}}, {{tone}} tone, under 80 words, with 2–3 relevant hashtags. ' +
        'Reply with only the post.',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'review',
      title: 'Approve the post',
      description:
        'Check the draft. Add a note with changes if you approve with edits.',
      kind: 'approval_gate',
    },
    {
      key: 'publish',
      title: 'Queue in Buffer',
      description:
        'Take the drafted post (apply any edits in the approval note) and add it to the Buffer queue with the Buffer tools. ' +
        'Reply in {{language}} with one line confirming it is queued, plus the final text.',
      kind: 'agent',
      agent: '{{agent}}',
    },
    {
      key: 'dropped',
      title: 'Not posted',
      description:
        'The post was rejected. Reply in {{language}} with one line saying it was not posted, including the reviewer’s note if any.',
      kind: 'agent',
      agent: '{{agent}}',
    },
  ],
  edges: [
    { from: 'draft', to: 'review', edgeKind: 'dependency' },
    {
      from: 'review',
      to: 'publish',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'approved',
    },
    {
      from: 'review',
      to: 'dropped',
      edgeKind: 'conditional',
      conditionOperator: 'equals',
      conditionValue: 'rejected',
    },
  ],
};
