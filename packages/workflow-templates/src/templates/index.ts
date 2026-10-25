import type { WorkflowTemplate } from '@openaidy/shared-types';
import { appointmentRemindersTemplate } from './appointment-reminders.js';
import { dailySalesSummaryTemplate } from './daily-sales-summary.js';
import { inboxTriageTemplate } from './inbox-triage.js';
import { invoiceChaseTemplate } from './invoice-chase.js';
import { socialPostApprovalTemplate } from './social-post-approval.js';
import { softwareDevelopmentWorkflowTemplate } from './software-development.js';
import { whatsappFaqTemplate } from './whatsapp-faq.js';
import { whatsappLeadBookingTemplate } from './whatsapp-lead-booking.js';

/** Shown in this order in the gallery. */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  whatsappLeadBookingTemplate,
  whatsappFaqTemplate,
  appointmentRemindersTemplate,
  invoiceChaseTemplate,
  dailySalesSummaryTemplate,
  inboxTriageTemplate,
  socialPostApprovalTemplate,
  softwareDevelopmentWorkflowTemplate,
];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
