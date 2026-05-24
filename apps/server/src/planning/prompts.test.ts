/**
 * Planning Prompts Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildAgentContextPrompt, buildPlanningPrompt } from './prompts';
import type { AgentSummary } from '../agents/schema';
import type { Task } from '@openaidy/db';

describe('buildAgentContextPrompt', () => {
  const mockAgents: AgentSummary[] = [
    {
      id: 'agent-1',
      name: 'Researcher',
      description: 'Research focused agent',
      model: 'gpt-4',
      tools: ['web_fetch', 'workspace_read'],
      skills: [],
      mcpServers: [],
      enabled: true,
      tags: [],
    },
    {
      id: 'agent-2',
      name: 'Creative',
      description: 'Creative content agent',
      model: 'gpt-4',
      tools: ['workspace_write', 'present_choices'],
      skills: ['creative-writing'],
      mcpServers: [{ id: 'github' }],
      enabled: true,
      tags: [],
    },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns message when no agents provided', () => {
    const result = buildAgentContextPrompt([], '/tmp/openaidy');
    expect(result).toBe('No agents available for assignment.');
  });

  it('includes agent name and description', () => {
    const result = buildAgentContextPrompt(mockAgents, '/tmp/openaidy');
    expect(result).toContain('Researcher');
    expect(result).toContain('Research focused agent');
    expect(result).toContain('Creative');
    expect(result).toContain('Creative content agent');
  });

  it('includes agent IDs', () => {
    const result = buildAgentContextPrompt(mockAgents, '/tmp/openaidy');
    expect(result).toContain('agent-1');
    expect(result).toContain('agent-2');
  });

  it('includes tools for each agent', () => {
    const result = buildAgentContextPrompt(mockAgents, '/tmp/openaidy');
    expect(result).toContain('web_fetch');
    expect(result).toContain('workspace_read');
    expect(result).toContain('workspace_write');
  });

  it('includes skills for each agent', () => {
    const result = buildAgentContextPrompt(mockAgents, '/tmp/openaidy');
    expect(result).toContain('creative-writing');
  });

  it('includes MCP servers for each agent', () => {
    const result = buildAgentContextPrompt(mockAgents, '/tmp/openaidy');
    expect(result).toContain('github');
  });

  it('shows "None" when agent has no tools', () => {
    const agentsWithoutTools: AgentSummary[] = [
      {
        id: 'empty',
        name: 'Empty',
        description: '',
        model: 'gpt-4',
        tools: [],
        skills: [],
        mcpServers: [],
        enabled: true,
        tags: [],
      },
    ];
    const result = buildAgentContextPrompt(agentsWithoutTools, '/tmp/openaidy');
    expect(result).toContain('Tools: None');
  });

  it('shows "None" when agent has no skills', () => {
    const agentsWithoutSkills: AgentSummary[] = [
      {
        id: 'empty',
        name: 'Empty',
        description: '',
        model: 'gpt-4',
        tools: [],
        skills: [],
        mcpServers: [],
        enabled: true,
        tags: [],
      },
    ];
    const result = buildAgentContextPrompt(
      agentsWithoutSkills,
      '/tmp/openaidy',
    );
    expect(result).toContain('Skills: None');
  });

  it('shows "None" when agent has no MCP servers', () => {
    const agentsWithoutMcp: AgentSummary[] = [
      {
        id: 'empty',
        name: 'Empty',
        description: '',
        model: 'gpt-4',
        tools: [],
        skills: [],
        mcpServers: [],
        enabled: true,
        tags: [],
      },
    ];
    const result = buildAgentContextPrompt(agentsWithoutMcp, '/tmp/openaidy');
    expect(result).toContain('MCP Servers: None');
  });

  it('includes "Available Agents" header', () => {
    const result = buildAgentContextPrompt(mockAgents, '/tmp/openaidy');
    expect(result).toContain('Available Agents:');
  });

  it('includes assignment guidelines', () => {
    const result = buildAgentContextPrompt(mockAgents, '/tmp/openaidy');
    expect(result).toContain('Tool availability');
    expect(result).toContain('Skill match');
    expect(result).toContain('Specialization');
    expect(result).toContain('workload balanced');
  });

  it('reads AGENT.md file when it exists', () => {
    const agentMdPath = path.join(
      '/tmp/openaidy',
      '.openaidy',
      'workspaces',
      'agent-1',
      'AGENT.md',
    );
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      'Specializes in research tasks',
    );

    const result = buildAgentContextPrompt([mockAgents[0]!], '/tmp/openaidy');

    expect(fs.existsSync).toHaveBeenCalledWith(agentMdPath);
    expect(fs.readFileSync).toHaveBeenCalledWith(agentMdPath, 'utf-8');
    expect(result).toContain('Specialization (from AGENT.md):');
    expect(result).toContain('Specializes in research tasks');
  });

  it('does not include AGENT.md section when file does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const result = buildAgentContextPrompt([mockAgents[0]!], '/tmp/openaidy');

    expect(result).not.toContain('Specialization (from AGENT.md):');
  });

  it('handles missing description gracefully', () => {
    const agentNoDesc: AgentSummary[] = [
      {
        id: 'no-desc',
        name: 'NoDesc',
        description: '',
        model: 'gpt-4',
        tools: [],
        skills: [],
        mcpServers: [],
        enabled: true,
        tags: [],
      },
    ];
    const result = buildAgentContextPrompt(agentNoDesc, '/tmp/openaidy');
    expect(result).toContain('No description');
  });
});

describe('buildPlanningPrompt', () => {
  const mockTask = {
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description for planning',
    planningEnabled: true,
  } as unknown as Task;

  it('includes task title', () => {
    const result = buildPlanningPrompt(mockTask, 4);
    expect(result).toContain('Test Task');
  });

  it('includes task description', () => {
    const result = buildPlanningPrompt(mockTask, 4);
    expect(result).toContain('Test description for planning');
  });

  it('includes max subtasks limit', () => {
    const result = buildPlanningPrompt(mockTask, 4);
    expect(result).toContain('1-4 subtasks');
  });

  it('includes agent context when provided', () => {
    const agentContext = 'Available Agents:\n## Researcher\n- Tools: web_fetch';
    const result = buildPlanningPrompt(mockTask, 4, agentContext);
    expect(result).toContain('Available Agents:');
    expect(result).toContain('Researcher');
  });

  it('includes fallback message when no agent context provided', () => {
    const result = buildPlanningPrompt(mockTask, 4);
    expect(result).toContain('No agent context available');
  });

  it('includes assignment requirements', () => {
    const result = buildPlanningPrompt(mockTask, 4);
    expect(result).toContain('atomic');
    expect(result).toContain('dependencies');
    expect(result).toContain('best agent');
  });

  it('requests assignedAgentId in response format', () => {
    const result = buildPlanningPrompt(mockTask, 4);
    expect(result).toContain('assignedAgentId');
  });

  it('requests assignmentReason in response format', () => {
    const result = buildPlanningPrompt(mockTask, 4);
    expect(result).toContain('assignmentReason');
  });
});
