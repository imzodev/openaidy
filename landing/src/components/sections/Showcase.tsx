import { motion } from 'framer-motion';

interface ShowcaseItem {
  title: string;
  description: string;
  glowColor: 'green' | 'purple' | 'pink';
  mockTitle: string;
  body: React.ReactNode;
}

const ITEMS: ShowcaseItem[] = [
  {
    title: 'Task Pipeline',
    description:
      'Structured kanban with async runs and step-by-step visibility.',
    glowColor: 'green',
    mockTitle: 'Tasks — Kanban',
    body: (
      <div className="mock-body mock-kanban">
        <KanbanCol
          header="Backlog"
          cards={[
            { bars: [70, 45], opacity: 0.5 },
            { bars: [55, 80], opacity: 0.5 },
          ]}
        />
        <KanbanCol
          header="In Progress"
          cards={[
            { bars: [65, 40], opacity: 1, active: true, tag: 'agent-1' },
            { bars: [50], opacity: 0.5 },
          ]}
        />
        <KanbanCol header="Review" cards={[{ bars: [60, 35], opacity: 0.5 }]} />
        <KanbanCol
          header="Done"
          cards={[
            { bars: [75, 30], opacity: 0.5 },
            { bars: [55], opacity: 0.5 },
            { bars: [65, 40], opacity: 0.5 },
          ]}
        />
      </div>
    ),
  },
  {
    title: 'Agent Management',
    description: 'Configure personality, tools, and MCP connections per agent.',
    glowColor: 'purple',
    mockTitle: 'Agents',
    body: (
      <div className="mock-body mock-agents">
        <AgentRow
          color="blue"
          letter="A"
          name="Coder"
          meta="gpt-4o · 3 tools · active"
          status="active"
        />
        <AgentRow
          color="purple"
          letter="B"
          name="Reviewer"
          meta="claude-4 · 2 tools · idle"
          status="idle"
        />
        <AgentRow
          color="pink"
          letter="C"
          name="DevOps"
          meta="gpt-4o · 5 tools · active"
          status="active"
        />
        <AgentRow
          color="cyan"
          letter="D"
          name="Researcher"
          meta="claude-4 · 4 tools · idle"
          status="idle"
        />
      </div>
    ),
  },
  {
    title: 'Session Memory',
    description:
      'Conversational context preserved per session. Pick up where you left off.',
    glowColor: 'pink',
    mockTitle: 'Sessions',
    body: (
      <div className="mock-body mock-sessions">
        <SessionItem
          active
          name="Fix auth middleware bug"
          time="2 min ago · 14 messages"
        />
        <SessionItem
          name="Refactor user service"
          time="1 hour ago · 8 messages"
        />
        <SessionItem
          name="Deploy to staging"
          time="3 hours ago · 22 messages"
        />
        <SessionItem name="Write API docs" time="Yesterday · 5 messages" />
      </div>
    ),
  },
];

function KanbanCol({
  header,
  cards,
}: {
  header: string;
  cards: {
    bars: number[];
    opacity: number;
    active?: boolean;
    tag?: string;
  }[];
}) {
  return (
    <div className="kanban-col">
      <div className="kanban-col-header">{header}</div>
      {cards.map((c, i) => (
        <div
          key={i}
          className={`kanban-card${c.active ? ' kanban-card--active' : ''}`}
          style={{ opacity: c.opacity }}
        >
          {c.bars.map((w, j) => (
            <div key={j} className="kanban-bar" style={{ width: `${w}%` }} />
          ))}
          {c.tag && <div className="kanban-tag">{c.tag}</div>}
        </div>
      ))}
    </div>
  );
}

function AgentRow({
  color,
  letter,
  name,
  meta,
  status,
}: {
  color: 'blue' | 'purple' | 'pink' | 'cyan';
  letter: string;
  name: string;
  meta: string;
  status: 'active' | 'idle';
}) {
  return (
    <div className="agent-row">
      <div className={`agent-avatar agent-avatar--${color}`}>{letter}</div>
      <div className="agent-info">
        <div className="agent-name">{name}</div>
        <div className="agent-meta">{meta}</div>
      </div>
      <div className={`agent-status agent-status--${status}`} />
    </div>
  );
}

function SessionItem({
  active = false,
  name,
  time,
}: {
  active?: boolean;
  name: string;
  time: string;
}) {
  return (
    <div className={`session-item${active ? ' session-item--active' : ''}`}>
      <div className={`session-dot${active ? ' session-dot--active' : ''}`} />
      <div className="session-info">
        <div className="session-name">{name}</div>
        <div className="session-time">{time}</div>
      </div>
    </div>
  );
}

function MockTitleBar({ title }: { title: string }) {
  return (
    <div className="mock-titlebar">
      <div className="mock-dots">
        <span />
        <span />
        <span />
      </div>
      <span className="mock-title">{title}</span>
    </div>
  );
}

function MockWindow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mock-window">
      <MockTitleBar title={title} />
      {children}
    </div>
  );
}

export function Showcase() {
  return (
    <section className="showcase">
      <motion.div
        className="showcase-header"
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-50px' }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <h2>Built for real workflows</h2>
        <p>
          From task management to multi-agent orchestration — see OpenAidy in
          action.
        </p>
      </motion.div>

      <div className="showcase-grid">
        {ITEMS.map((item, i) => (
          <motion.div
            key={item.title}
            className="showcase-card"
            initial={{ opacity: 0, y: 60, rotateX: 8 }}
            whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{
              duration: 0.7,
              delay: i * 0.12,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <div className="showcase-screen">
              <MockWindow title={item.mockTitle}>{item.body}</MockWindow>
              <div
                className={`showcase-glow showcase-glow--${item.glowColor}`}
              />
            </div>
            <div className="showcase-label">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
