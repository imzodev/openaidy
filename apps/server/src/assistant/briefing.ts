import type { JobsStore, TasksStore, WorkflowRunsStore } from '@openaidy/db';
import type { TaskService } from '../tasks/service';

export type BriefingFactsDeps = {
  taskService: Pick<TaskService, 'listPendingApprovals'> | undefined;
  workflowRuns: WorkflowRunsStore | undefined;
  tasks: TasksStore | undefined;
  jobs: JobsStore | undefined;
  timezone: string;
  now?: Date;
};

const timeIn = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

const dayIn = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);

/**
 * What OpenAidy itself knows that belongs in the owner's briefing: what's
 * waiting on them, what went wrong since yesterday, and what's coming up
 * today. Plain lines, added to the briefing prompt.
 */
export async function collectBriefingFacts(
  deps: BriefingFactsDeps,
): Promise<string[]> {
  const now = deps.now ?? new Date();
  const facts: string[] = [];

  const approvals = (await deps.taskService?.listPendingApprovals()) ?? [];
  for (const approval of approvals) {
    facts.push(
      `Waiting for the owner's approval: "${approval.title}" in workflow "${approval.taskTitle}".`,
    );
  }

  if (deps.workflowRuns) {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const runs = await deps.workflowRuns.listFinishedSince(since);
    const failed = runs.filter((r) => r.status === 'failed');
    const completed = runs.filter((r) => r.status === 'completed').length;
    for (const run of failed.slice(0, 5)) {
      const task = await deps.tasks?.findById(run.taskId);
      facts.push(
        `Workflow "${task?.title ?? run.taskId}" failed: ${run.error ?? 'a step failed'}.`,
      );
    }
    if (completed > 0) {
      facts.push(
        `${completed} workflow run(s) completed in the last 24 hours.`,
      );
    }
  }

  if (deps.jobs) {
    const today = dayIn(now, deps.timezone);
    const jobs = await deps.jobs.list({ limit: 1000 });
    const reminders = jobs
      .filter((job) => {
        const meta = job.metadata as Record<string, unknown> | null;
        return (
          meta?.['kind'] === 'reminder' &&
          job.status === 'active' &&
          dayIn(job.nextRunAt, deps.timezone) === today
        );
      })
      .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());
    for (const job of reminders) {
      const meta = job.metadata as Record<string, unknown>;
      facts.push(
        `Reminder today at ${timeIn(job.nextRunAt, deps.timezone)}: ${String(meta['name'] ?? 'reminder')}.`,
      );
    }
  }
  return facts;
}
