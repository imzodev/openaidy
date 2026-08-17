/**
 * Title is optional on both tasks and subtasks — when omitted (or blank),
 * derive a short display title from the description instead of forcing
 * the caller to invent one. Same truncation rule everywhere it's used
 * (task/subtask creation routes, workflow-template application) so a
 * task, a subtask, and a template-seeded node all "look" the same when
 * auto-named.
 */
export function deriveTitleFromDescription(description: string): string {
  return description.length > 60
    ? `${description.slice(0, 60).trimEnd()}…`
    : description;
}
