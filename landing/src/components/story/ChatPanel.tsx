import { CHAT_CHAPTERS } from './storyData';

export function ChatPanelBody({ chapter }: { chapter: number }) {
  const data = CHAT_CHAPTERS[chapter];
  if (!data) return null;
  const { user, agent, check, live, input } = data;
  return (
    <>
      <div className="chat-msg chat-msg--user">
        <span className="chat-avatar chat-avatar--user">{user.avatar}</span>
        <div>
          <div className="chat-meta">{user.meta}</div>
          <div className="chat-text">{user.text}</div>
        </div>
      </div>

      <div className="chat-msg chat-msg--agent">
        <span className="chat-avatar chat-avatar--agent">{agent.avatar}</span>
        <div>
          <div className="chat-meta">{agent.meta}</div>
          <div className="chat-text">{agent.text}</div>
          <div className="chat-status">
            <span className="chat-check">✓</span> {check}
          </div>
        </div>
      </div>

      <div className="chat-msg chat-msg--agent">
        <span className="chat-avatar chat-avatar--agent">{agent.avatar}</span>
        <div>
          <div className="chat-status chat-status--live">
            <span className="chat-dot" /> {live}
          </div>
        </div>
      </div>

      <div className="chat-input">
        <span>{input}</span>
        <span className="chat-input-arrow">→</span>
      </div>
    </>
  );
}
