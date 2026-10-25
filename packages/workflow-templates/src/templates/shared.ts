import type {
  TemplateInput,
  TemplateRequirement,
} from '@openaidy/shared-types';

/**
 * Inputs and requirements the small-business templates share, so every
 * template asks for them the same way.
 */

export const languageInput: TemplateInput = {
  key: 'language',
  label: 'Language for messages',
  type: 'select',
  default: 'Spanish',
  options: [
    { value: 'Spanish', label: 'Español' },
    { value: 'English', label: 'English' },
    { value: 'Portuguese', label: 'Português' },
  ],
};

export const agentInput: TemplateInput = {
  key: 'agent',
  label: 'Agent that does the work',
  type: 'agent',
  help: 'It needs the integrations listed below. Leave empty for your default agent.',
};

export const channelInput: TemplateInput = {
  key: 'channel',
  label: 'WhatsApp channel',
  type: 'channel',
  required: true,
};

export const ownerPhoneInput: TemplateInput = {
  key: 'owner_phone',
  label: 'Your WhatsApp number (for updates)',
  type: 'string',
  required: true,
  help: 'With country code, e.g. +52 155 1234 5678.',
};

export const businessInput: TemplateInput = {
  key: 'business',
  label: 'About your business',
  type: 'text',
  required: true,
  help: 'What you offer, prices, hours, location — whatever the agent should know.',
};

export const paymentProviderInput: TemplateInput = {
  key: 'provider',
  label: 'Payments / invoicing',
  type: 'select',
  default: 'Stripe',
  options: [
    { value: 'Stripe', label: 'Stripe' },
    { value: 'Mercado Pago', label: 'Mercado Pago' },
    { value: 'PayPal', label: 'PayPal' },
    { value: 'Square', label: 'Square' },
  ],
};

export const sendToolRequirement: TemplateRequirement = {
  key: 'channel_send',
  label: 'An agent with the channel_send tool',
  check: { tools: ['channel_send'] },
};

export const paymentsRequirement: TemplateRequirement = {
  key: 'payments',
  label: 'Stripe, Mercado Pago, PayPal or Square connected',
  check: { mcpServerIds: ['stripe', 'mercadopago', 'paypal', 'square'] },
};

/** How a step sends WhatsApp updates to the owner. */
export const TELL_OWNER =
  'Send it to the owner with the channel_send tool: channelId "{{channel}}", to "{{owner_phone}}".';
