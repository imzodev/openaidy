---
summary: 'Tasks, subtasks and workflows: building a workflow graph (branches, joins, loops, approval steps), running it, and the agent tools and API for both'
read_when:
  - You want to run multi-step, structured work instead of a single chat
  - You are building a workflow with conditional branches, loops, or a human approval step
  - You want an agent to build or run a workflow for you
title: 'Tasks'
---

# Tasks

A task is structured, trackable work — as opposed to a session, which is just a conversation. Tasks live on a kanban board and move through `backlog → todo → in_progress → review → done` (or `cancelled` at any point). Every task has a `priority` (`low`/`medium`/`high`/`urgent`).

A simple task can just run directly against a single session. A complex task gets broken into **subtasks**.

## Subtasks

A subtask is one discrete step, each running in its own [session](./sessions.md) so its transcript stays isolated. A subtask can be assigned to a specific agent; without one, the default agent runs it.

You can create subtasks manually, or enable **planning** on a task (`planningEnabled: true`) — a planning agent decomposes the task's description into subtasks automatically. Planning itself has its own status (`pending → in_progress → completed`/`failed`) tracked separately from the task's own status.

## Workflows

A **workflow** is a task whose steps you (or an agent) lay out as a graph instead of letting the planner write a checklist. Workflows have their own page in the web UI: the **Workflows** page lists them, and opening one shows the visual editor — a canvas of steps and connections, with a side panel for editing whatever is selected.

There are two kinds of step:

- **Agent step** — an agent does the work described in the step.
- **Approval step** (`approval_gate`) — the workflow pauses until a person approves or rejects. Use one before anything that sends, publishes or spends.

Steps are connected by **edges**. An edge from A to B means "B waits for A".

### Branching on an outcome

An edge can carry a **condition**, which makes it a conditional edge: it is only taken when the upstream step's outcome matches.

Every step that has conditional edges going out of it (or a loop) is asked to end its reply with a line like `OUTCOME: approved`, and is told which values its branches are waiting for. The **last** `OUTCOME:` line counts. If a step doesn't write one, the start of its reply is used instead. Approval steps always end as `OUTCOME: approved` or `OUTCOME: rejected`, with the reviewer's note underneath.

| Operator        | Taken when the outcome…                         |
| --------------- | ----------------------------------------------- |
| `equals`        | is exactly the value (ignoring case and spaces) |
| `contains`      | contains the value (ignoring case)              |
| `matches_regex` | matches the regular expression (ignoring case)  |

So a review that can go two ways is two conditional edges out of the same step — `approved → Publish` and `rejected → Revise` — and only one of them runs.

### How steps decide to run, wait or skip

Each time a step finishes, every step after it is re-evaluated:

- It **waits** while any step it depends on hasn't finished.
- It is **skipped** when one of those steps failed, when a conditional edge into it wasn't matched, or when it follows a rejected approval with a plain edge. A skipped step's own downstream steps are evaluated the same way, so a branch that isn't taken is skipped all the way down. The step panel shows why a step was skipped.
- Otherwise it **runs** once at least one incoming edge is satisfied. This means two exclusive branches can join again: a "Notify" step after both `Publish` and `Revise` runs after whichever of the two actually ran.

A run is finished when every step has completed, failed or been skipped.

### Loops

A step can repeat itself until its outcome matches a condition — "repeat until `OUTCOME: PASS`, at most 3 times". Each attempt sees the previous attempt's result so it can fix it. If the limit is reached without a match, the step fails. Loops are set on the step itself ("Repeat until condition" in the panel), not with an edge; an edge back to an earlier step would be a cycle, which isn't allowed. Approval steps can't loop. The limit is 1 to 50.

## Running a workflow

Press **Run** on the workflow page (or use the `workflow_execute` tool, or put the task on a [schedule](./task-schedules.md)). Each press starts a fresh **run**: every step is reset, the first steps start, and the rest follow as their dependencies finish.

- **Before it starts**, the workflow is checked. Problems that would stop it from running as built — no steps, a cycle, an agent step without a description, an agent that doesn't exist, an invalid regex — are listed and block the run. Things that look unintended, such as a step that isn't connected to anything or an approval branch waiting for something other than approved/rejected, are listed as warnings you can run past.
- **While it runs**, the header shows "Running · 2 of 5 steps done", running steps spin on the canvas, and the page updates live. **Stop** ends the run: the step in progress is cancelled and nothing else starts.
- **When an approval step is reached**, a banner with Approve and Reject appears on the workflow page, the Workflows item in the sidebar shows a count, and the workflow's card says it's waiting for you. An agent you're chatting with (for example on WhatsApp) can list waiting approvals and pass your decision on; it's recorded as coming from that agent.
- **When a step fails**, the run ends as failed and the step panel shows why. **Retry step** runs that step again with everything after it, continuing the same run.
- **Runs history** (the clock button) lists every run — how it was started, how long it took, and how each step ended, with a link to each step's conversation.

If the server restarts in the middle of a run, steps that were in progress are marked as failed ("The server restarted while this step was running"), so the run ends instead of hanging; retry them to continue. Approval steps that were waiting keep waiting.

On the board, a run that completes moves the task to `review`; a failed or stopped run moves it back to `todo`.

## Triggers: starting a workflow by itself

Besides **Run**, schedules and agents, a workflow can start when something happens outside OpenAidy. Open the workflow and use the **Triggers** panel (the lightning button):

- **Webhook** — a URL other services (a website form, Zapier, a payment provider…) POST to. The request body (JSON, form or text) becomes the run's input. Each webhook has its own token, shown once when it's created; send it as `Authorization: Bearer <token>`, or as `?token=<token>` for services that can't set headers. **New token** replaces it, and the old one stops working. The response is `202` with the run id; `401` for a wrong token, `404` for an unknown or switched-off webhook, `409` if the workflow is already running and `422` if it can't run as built. All webhooks are listed on the **Webhooks** page.
- **Message trigger** — a message on a [channel](./channels.md) (WhatsApp, Discord) that matches a rule: starts with, contains, is exactly, matches a regex, or any message, ignoring case. You can limit it to certain senders. A matching message starts the workflow **instead of** going to the channel's chat agent: the sender gets an immediate reply ("On it — running …", or your own text), and when the run ends the result of its last steps is sent back to the same chat (or why it failed or was stopped). If an approval step is reached, the chat is told it's waiting for approval in OpenAidy. If the workflow is already running, the sender is asked to try again once it has finished.

What started a run is its **input**: every step's instructions begin with it, and it's shown in the run's entry in the Runs panel. A run started with **Run** or by an agent can be given input too (`input` on `POST /tasks/:id/execute` and on `workflow_execute`).

## Editing a workflow

Edits are saved as you make them; "Saved" appears once the server has confirmed the change, and an error banner explains anything it refused. The same rules apply everywhere — the editor, the agent tools and the API all use one validator — so a graph accepted by one is never rejected or mis-run by another. A single edit is only refused for a problem it introduces, not for an older one elsewhere in the graph.

- **While a run is going, the steps can't be changed.** Stop the run first. (Moving nodes around is still allowed.)
- **Changing a completed step** (its description, title, type or loop, or an edge into it) puts it and every step after it back to pending, since their results no longer match. A failed step keeps its status, so you can still retry it after fixing it.
- Deleting a step asks for confirmation and removes its connections too.
- Node positions are saved with the workflow, so the layout is the same on every device.

### Three ways to create one

**New Workflow** offers three starting points:

- **Describe it** — write what should happen in a sentence or two ("When a customer sends _cita_ on WhatsApp, check my calendar and offer two times; ask me before confirming"). The default agent's model drafts the steps, branches, approval steps and how it starts; you see the draft before anything is created, and can re-draft or adjust it in the editor afterwards. The draft is checked by the same validator as everything else (and repaired once if it isn't valid).
- **From a template** — a ready-made workflow with a short form (see below).
- **Build it yourself** — an empty canvas, optionally on a schedule.

### Templates

| Template                             | Starts                                                      | What it does                                                                                                                                 | Needs                                                  |
| ------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| WhatsApp lead → offer an appointment | A WhatsApp message starting with a keyword (default _cita_) | Qualifies the lead, then offers two free slots from your calendar, asks what they need, or closes politely — the reply goes back to the chat | Google Calendar                                        |
| Customer questions on WhatsApp       | A WhatsApp message containing a keyword (default `?`)       | Answers from what you wrote about your business; otherwise tells you and lets the customer know a person will follow up                      | `channel_send`                                         |
| Appointment reminders                | Every day at 18:00                                          | Reminds tomorrow's clients on WhatsApp (numbers from your calendar events) and sends you the list                                            | Google Calendar, `channel_send`                        |
| Chase overdue invoices               | Every day at 9:00                                           | Finds unpaid invoices, drafts reminders, waits for your approval, sends them                                                                 | Stripe, Mercado Pago, PayPal or Square; `channel_send` |
| Daily sales summary                  | Every day at 8:00                                           | Yesterday's sales, compared with last week, on WhatsApp                                                                                      | A payments integration, `channel_send`                 |
| Inbox triage + reply drafts          | Every hour                                                  | Sorts new email and leaves reply drafts in Gmail (never sends), then tells you                                                               | Gmail, `channel_send`                                  |
| Social post from a WhatsApp idea     | A WhatsApp message starting with _post_                     | Drafts the post, waits for your approval, queues it in Buffer (or tells you it wasn't posted)                                                | Buffer                                                 |
| Software development                 | By hand                                                     | Plan → implement → test (repeats until the tests pass) → code review approval → merge and deploy                                             | GitHub                                                 |

Each template asks for a few inputs — the WhatsApp channel, your number for updates, a few lines about your business, the language its messages are written in (Spanish by default), and which agent does the work. Integrations come from the [MCP servers](./mcp-servers.md) catalog, and `channel_send` is a built-in tool to enable on the agent; the form shows which ones no agent has yet, but doesn't stop you. With **Set up how it starts** checked, the template's message trigger or schedule is created with the workflow.

Applying a template adds its steps; with `clearExisting` (API and agent tools) it replaces the current steps, and the old ones are only removed once the template's are in place, so a failure changes nothing.

## Building workflows with an agent

Agents manage workflows with the `workflow_*` tools. The most reliable way for an agent to build one is to describe the whole graph in a single call:

```json
{
  "description": "Weekly newsletter",
  "nodes": [
    {
      "key": "draft",
      "description": "Write this week's issue",
      "agent": "Writer"
    },
    { "key": "review", "title": "Review", "kind": "approval_gate" },
    { "key": "send", "description": "Send the issue" },
    { "key": "revise", "description": "Apply the reviewer's notes" }
  ],
  "edges": [
    { "from": "draft", "to": "review" },
    { "from": "review", "to": "send", "condition": "approved" },
    { "from": "review", "to": "revise", "condition": "rejected" }
  ]
}
```

- `workflow_create` with `nodes`/`edges` creates the workflow and its graph together. The graph is validated first; if it has problems, nothing is created and every problem is listed (for example `Edge 3 (code → tests): unknown node "tests".`), so the agent can fix them all and try again.
- `workflow_set_graph` replaces an existing workflow's whole graph the same way (`dryRun: true` only validates). `workflow_get` returns the graph in a shape `workflow_set_graph` accepts back, plus a `problems` list.
- Node fields: `key`, `title`, `description`, `kind` (`agent` or `approval_gate`), `agent` (an agent id or name), `loop` (`{maxIterations, conditionOperator, conditionValue}`). Edge fields: `from`, `to`, and optionally `condition` (the outcome value) with `operator` (`equals` by default, `contains` or `matches_regex`).
- For small changes there are `workflow_node_*` and `workflow_edge_*` tools, and `workflow_apply_template` for templates.
- `workflow_template_list` lists the templates with their inputs; `workflow_create` (or `workflow_apply_template`) with `templateId`, `templateInputs` and `setupTrigger: true` sets one up, including how it starts.
- `workflow_trigger_create`, `workflow_trigger_list` and `workflow_trigger_delete` add and manage webhooks and message triggers (for example "when someone sends a WhatsApp message starting with _quote_, run this workflow").
- `workflow_execute` starts a run (optionally with `input`) and returns immediately; `workflow_approval_list` and `workflow_approval_resolve` let an agent relay approval decisions. An agent should only resolve an approval with a decision the user actually gave.

## API

The web UI uses these routes (all under `/api`, authenticated):

| Route                                          | Purpose                                                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /tasks/:id/workflow-check`                | Errors and warnings for the current graph (the pre-run checklist)                                                                                                       |
| `PUT /tasks/:id/graph`                         | Replace the whole graph (`{nodes, edges, dryRun?}`, same format as the agent tools)                                                                                     |
| `POST /workflows/draft`                        | Draft a workflow from `{description}`: returns `{title, graph, trigger, warnings}` without saving                                                                       |
| `PUT /tasks/:id/layout`                        | Save node positions (`{positions: {[stepId]: {x, y}}}`)                                                                                                                 |
| `POST /tasks/:id/apply-template`               | Apply a template (`{templateId, inputs?, clearExisting?}`)                                                                                                              |
| `POST /tasks/:id/execute`                      | Start a run (`{input?}`)                                                                                                                                                |
| `GET /tasks/:id/triggers`                      | The workflow's webhooks and message triggers                                                                                                                            |
| `POST /tasks/:id/triggers`                     | Add one (`{kind: 'webhook'}` returns the token once, or `{kind: 'channel_message', channel: {channelId, match: {type, value?}, senders?, replyWithResult?, ackText?}}`) |
| `PATCH /workflow-triggers/:id`                 | Rename, switch on/off, change a message rule                                                                                                                            |
| `DELETE /workflow-triggers/:id`                | Delete a trigger                                                                                                                                                        |
| `POST /workflow-triggers/:id/regenerate-token` | Replace a webhook's token                                                                                                                                               |
| `GET /workflow-triggers?kind=webhook`          | Every trigger across workflows                                                                                                                                          |
| `POST /tasks/:id/runs/cancel`                  | Stop the current run                                                                                                                                                    |
| `GET /tasks/:id/runs`                          | Run history                                                                                                                                                             |
| `POST /subtasks/:id/retry`                     | Retry a failed or skipped step and continue the run                                                                                                                     |
| `POST /subtasks/:id/approval/resolve`          | Approve or reject (`{decision, note?}`)                                                                                                                                 |
| `GET /approvals/pending`                       | Approval steps waiting for a decision, across all workflows                                                                                                             |
| `POST /subtasks/:id/assign`                    | Assign an agent (`{agentId}`, or `{agentId: null}` for the default agent)                                                                                               |

The webhook endpoint itself, `POST /api/hooks/:triggerId`, is not behind the login; its token is the credential.

A graph that fails validation returns `400` with `error.code: "workflow.invalid_graph"` and the individual problems in `error.details.issues`; an edit while a run is going returns `409` with `workflow.locked`. Run and step changes are also pushed over the WebSocket as `workflow.updated` events (`{taskId}`), which is how the editor updates live.

## Verification and retries

When a step finishes, its result can go through verification before being marked complete — if verification rejects it, the step retries automatically (up to a configurable limit) with the rejection reason fed back into the next attempt. A step that seems stuck (no progress for a while and no agent working on it) is retried or failed depending on how many attempts it has had.

The retry limit, and how much of a completed dependency's result gets carried into the next step's prompt, are both configurable — see [Configuration](./config.md#execution-tuning).

## Related

- [Task Schedules](./task-schedules.md) — run a task automatically, on a recurring or one-shot schedule
- [Pulses](./pulses.md) — a separate, lighter-weight scheduled-prompt mechanism; see that page for how it differs from a scheduled task
