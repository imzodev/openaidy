import type { WorkflowTemplate } from '@openaidy/shared-types';

/**
 * Plan → Implement → Test (retry loop) → Code Review (approval gate,
 * gated on Test passing) → Merge & Deploy. Exercises the full template
 * shape: a bounded self-loop, a conditional branch, and a human approval
 * gate, plus a node ("Merge & Deploy") that needs an external capability
 * (GitHub access) no template can assume an agent already has.
 */
export const softwareDevelopmentWorkflowTemplate: WorkflowTemplate = {
  id: 'software-development',
  version: 1,
  name: 'Software Development Workflow',
  description:
    'Plan, implement, test with an automatic retry loop, then gate merge/deploy behind code review.',
  category: 'engineering',
  inputs: [
    {
      key: 'repo',
      label: 'Repository (owner/repo)',
      type: 'string',
      required: true,
    },
    {
      key: 'branch',
      label: 'Target branch',
      type: 'string',
      default: 'main',
    },
  ],
  requirements: [
    {
      key: 'github',
      label: 'GitHub MCP access',
      check: { mcpServerConfigured: true },
    },
  ],
  nodes: [
    {
      key: 'plan',
      title: 'Plan',
      description:
        'Break down the request into a concrete implementation approach for {{repo}}.',
      kind: 'agent',
    },
    {
      key: 'implement',
      title: 'Implement',
      description:
        'Implement the planned changes on {{repo}}, targeting branch {{branch}}.',
      kind: 'agent',
    },
    {
      key: 'test',
      title: 'Test',
      description:
        'Run the test suite against the implemented changes. End the result with OUTCOME: PASS or OUTCOME: FAIL.',
      kind: 'agent',
      loop: {
        maxIterations: 3,
        conditionOperator: 'contains',
        conditionValue: 'FAIL',
      },
    },
    {
      key: 'code_review',
      title: 'Code Review',
      description:
        'Review the passing changes on {{repo}} before merge and deploy.',
      kind: 'approval_gate',
    },
    {
      key: 'merge_deploy',
      title: 'Merge & Deploy',
      description:
        'Merge the reviewed PR into {{repo}} on branch {{branch}} and trigger deploy.',
      kind: 'agent',
    },
  ],
  edges: [
    { from: 'plan', to: 'implement', edgeKind: 'dependency' },
    { from: 'implement', to: 'test', edgeKind: 'dependency' },
    {
      from: 'test',
      to: 'code_review',
      edgeKind: 'conditional',
      conditionOperator: 'contains',
      conditionValue: 'PASS',
    },
    { from: 'code_review', to: 'merge_deploy', edgeKind: 'dependency' },
  ],
};
