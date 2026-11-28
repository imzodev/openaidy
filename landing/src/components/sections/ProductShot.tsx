import { Brain, CalendarClock, MessageCircle, Search } from 'lucide-react';

/**
 * A static rendering of the Aidy app in a macOS-style window: the sessions
 * sidebar and one conversation where an agent sets up a daily briefing.
 * Decorative only — screen readers get the caption via aria-label.
 */
export function ProductShot() {
  return (
    <div
      className="shot-window"
      role="img"
      aria-label="The Aidy app: an agent schedules a daily briefing sent to WhatsApp."
    >
      <div className="shot-titlebar">
        <span className="shot-light shot-light--red" />
        <span className="shot-light shot-light--yellow" />
        <span className="shot-light shot-light--green" />
        <span className="shot-title">Aidy</span>
      </div>

      <div className="shot-body">
        <aside className="shot-sidebar">
          <div className="shot-search">
            <Search size={12} />
            <span>Search</span>
          </div>
          <p className="shot-group">Today</p>
          {[
            ['Morning briefing', true],
            ['Invoice follow-ups', false],
            ['Website copy review', false],
          ].map(([title, active]) => (
            <div
              key={String(title)}
              className={`shot-session ${active ? 'shot-session--active' : ''}`}
            >
              {title}
            </div>
          ))}
          <p className="shot-group">Agents</p>
          {[
            ['Assistant', '#007aff'],
            ['Bookkeeper', '#34c759'],
            ['Researcher', '#ff9f0a'],
          ].map(([name, color]) => (
            <div key={name} className="shot-agent">
              <span className="shot-agent-dot" style={{ background: color }} />
              {name}
            </div>
          ))}
        </aside>

        <div className="shot-chat">
          <div className="shot-msg shot-msg--user">
            Every weekday at 8, send me a summary of unpaid invoices and today's
            meetings on WhatsApp.
          </div>

          <div className="shot-tool">
            <CalendarClock size={13} />
            <span>
              Scheduled <strong>Daily briefing</strong> · Mon–Fri 08:00
            </span>
          </div>

          <div className="shot-msg shot-msg--agent">
            Done. Your first briefing arrives tomorrow at 8:00. I&apos;ll keep
            it short — you prefer bullet points.
          </div>

          <div className="shot-tool shot-tool--soft">
            <MessageCircle size={13} />
            <span>Delivered to WhatsApp · ✓✓</span>
          </div>

          <div className="shot-composer">
            <span className="shot-chip">
              <Brain size={12} /> High
            </span>
            <span className="shot-input">Message Assistant…</span>
            <span className="shot-send" />
          </div>
        </div>
      </div>
    </div>
  );
}
