export function AgentsList() {
  return (
    <div className="mock-agents-list">
      <div className="agent-row">
        <div className="agent-avatar agent-avatar--blue">C</div>
        <div className="agent-info">
          <div className="agent-name">coder</div>
          <div className="agent-meta">gpt-4o · 4 tools · 2 MCP</div>
        </div>
        <div className="agent-status agent-status--active" />
      </div>
      <div className="agent-row agent-row--active">
        <div className="agent-avatar agent-avatar--purple">R</div>
        <div className="agent-info">
          <div className="agent-name">reviewer</div>
          <div className="agent-meta">
            claude-4 · 3 tools · skill: code-review
          </div>
        </div>
        <div className="agent-status agent-status--active" />
      </div>
      <div className="agent-row">
        <div className="agent-avatar agent-avatar--pink">O</div>
        <div className="agent-info">
          <div className="agent-name">ops</div>
          <div className="agent-meta">gpt-4o · 6 tools · shell + kubectl</div>
        </div>
        <div className="agent-status agent-status--idle" />
      </div>
      <div className="agent-row">
        <div className="agent-avatar agent-avatar--cyan">S</div>
        <div className="agent-info">
          <div className="agent-name">support</div>
          <div className="agent-meta">claude-4 · 2 tools · kb MCP</div>
        </div>
        <div className="agent-status agent-status--idle" />
      </div>
    </div>
  );
}

export function ChannelsList() {
  return (
    <div className="mock-channels">
      <div className="channel-row channel-row--connected">
        <div className="channel-icon channel-icon--slack">#</div>
        <div className="channel-info">
          <div className="channel-name">Slack · #dev</div>
          <div className="channel-meta">
            Connected · mentions trigger reviewer
          </div>
        </div>
        <div className="channel-state channel-state--on" />
      </div>
      <div className="channel-row channel-row--connected">
        <div className="channel-icon channel-icon--discord">D</div>
        <div className="channel-info">
          <div className="channel-name">Discord · /commands</div>
          <div className="channel-meta">Connected · slash commands</div>
        </div>
        <div className="channel-state channel-state--on" />
      </div>
      <div className="channel-row channel-row--connected">
        <div className="channel-icon channel-icon--telegram">T</div>
        <div className="channel-info">
          <div className="channel-name">Telegram · @openaidy_bot</div>
          <div className="channel-meta">Connected · DMs + groups</div>
        </div>
        <div className="channel-state channel-state--on" />
      </div>
      <div className="channel-row">
        <div className="channel-icon channel-icon--whatsapp">W</div>
        <div className="channel-info">
          <div className="channel-name">WhatsApp · not connected</div>
          <div className="channel-meta">Tap to connect</div>
        </div>
        <div className="channel-state channel-state--off" />
      </div>
    </div>
  );
}

export function SkillsList() {
  return (
    <div className="mock-skills">
      <div className="skill-row skill-row--active">
        <div className="skill-icon skill-icon--green">✓</div>
        <div className="skill-info">
          <div className="skill-name">code-review</div>
          <div className="skill-meta">
            v2.1.0 · openaidy · loaded on reviewer
          </div>
        </div>
      </div>
      <div className="skill-row skill-row--active">
        <div className="skill-icon skill-icon--green">✓</div>
        <div className="skill-info">
          <div className="skill-name">github-pr</div>
          <div className="skill-meta">v1.4.2 · openaidy · MCP</div>
        </div>
      </div>
      <div className="skill-row skill-row--active">
        <div className="skill-icon skill-icon--green">✓</div>
        <div className="skill-info">
          <div className="skill-name">kubectl-ops</div>
          <div className="skill-meta">v0.9.0 · community · loaded on ops</div>
        </div>
      </div>
      <div className="skill-row">
        <div className="skill-icon skill-icon--add">+</div>
        <div className="skill-info">
          <div className="skill-name">Add from registry</div>
          <div className="skill-meta">42 skills available</div>
        </div>
      </div>
    </div>
  );
}

export function KanbanMini() {
  return (
    <div className="mock-kanban-mini">
      <div className="mini-col">
        <div className="mini-col-header">Backlog</div>
        <div className="mini-card">
          <div className="mini-bar" style={{ width: '70%' }} />
        </div>
        <div className="mini-card">
          <div className="mini-bar" style={{ width: '55%' }} />
        </div>
      </div>
      <div className="mini-col">
        <div className="mini-col-header">In progress</div>
        <div className="mini-card mini-card--active">
          <div className="mini-bar" style={{ width: '85%' }} />
          <div className="mini-tag">reviewer</div>
        </div>
      </div>
      <div className="mini-col">
        <div className="mini-col-header">Done</div>
        <div className="mini-card">
          <div className="mini-bar" style={{ width: '60%' }} />
        </div>
        <div className="mini-card">
          <div className="mini-bar" style={{ width: '75%' }} />
        </div>
        <div className="mini-card">
          <div className="mini-bar" style={{ width: '50%' }} />
        </div>
      </div>
    </div>
  );
}

const WORKSPACE_BY_CHAPTER = [
  AgentsList,
  ChannelsList,
  SkillsList,
  KanbanMini,
] as const;

export function WorkspacePanelBody({ chapter }: { chapter: number }) {
  const Component = WORKSPACE_BY_CHAPTER[chapter] ?? KanbanMini;
  return <Component />;
}
