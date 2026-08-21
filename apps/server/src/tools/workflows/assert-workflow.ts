/**
 * Shared guard for the workflow_* tool family.
 *
 * A "workflow" in OpenAidy is a Task whose `planningEnabled` flag is true.
 * The web UI uses the same definition to gate access to the graph editor
 * (`apps/web/src/pages/WorkflowsPage.tsx`). Keeping a single source of truth
 * here means the agent tool family cannot drift from what the UI treats as
 * a workflow.
 */

type WorkflowLike = {
  id: string;
  planningEnabled?: boolean | null;
};

export type AssertWorkflowResult = { ok: true } | { ok: false; error: string };

/**
 * Reject any task the agent presents to a workflow_* tool that is not
 * actually a workflow. The error message is intentionally the same phrasing
 * the user would see in the UI so the agent gets the same explanation the
 * human gets when they try to open a non-workflow task in the graph editor.
 */
export function assertWorkflow(
  task: WorkflowLike | null,
): AssertWorkflowResult {
  if (!task) {
    return { ok: false, error: 'Workflow not found' };
  }
  if (task.planningEnabled !== true) {
    return {
      ok: false,
      error: `Task "${task.id}" is not a workflow (planningEnabled must be true). Use tasks_* tools for regular tasks, or set planningEnabled to convert it.`,
    };
  }
  return { ok: true };
}
