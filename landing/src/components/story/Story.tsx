import { useEffect, useRef, useState } from 'react';
import {
  motion,
  AnimatePresence,
  useTransform,
  useScroll,
} from 'framer-motion';
import {
  CHAPTERS,
  CHAT_PANEL_HEADERS,
  WORKSPACE_PANEL_HEADERS,
  WORKSPACE_TABS,
} from './storyData';
import { ChatPanelBody } from './ChatPanel';
import { WorkspacePanelBody } from './WorkspaceContent';

export function Story() {
  const storyRef = useRef<HTMLDivElement>(null);
  const [activeChapter, setActiveChapter] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const storyProgress = useScroll({
    target: storyRef,
    offset: ['start start', 'end end'],
  }).scrollYProgress;

  const chapterIndex = useTransform(
    storyProgress,
    [0, 0.25, 0.5, 0.75, 1],
    [0, 1, 2, 3, 3],
  );

  useEffect(() => {
    return chapterIndex.on('change', (v) => {
      setActiveChapter(Math.round(v));
    });
  }, [chapterIndex]);

  return (
    <section className="story">
      <div className="story-header">
        <h2>Built to collaborate with you</h2>
        <p>
          From task to delivery — every step of an agent's workflow, in one
          workspace.
        </p>
      </div>

      <div ref={storyRef} className="story-container">
        <div className="story-text">
          {!isMobile && (
            <div className="story-stepper" aria-hidden="true">
              <div className="story-step-line" />
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`story-step-dot ${activeChapter >= i ? 'story-step-dot--filled' : ''} ${activeChapter === i ? 'story-step-dot--active' : ''}`}
                />
              ))}
            </div>
          )}

          {!isMobile &&
            CHAPTERS.map((ch, i) => (
              <motion.div
                key={i}
                className={`story-chapter ${activeChapter === i ? 'story-chapter--active' : ''}`}
                animate={{ opacity: activeChapter === i ? 1 : 0.3 }}
                transition={{ duration: 0.5 }}
              >
                <span className="story-step">{ch.tag}</span>
                <h3>{ch.title}</h3>
                <p>{ch.description}</p>
              </motion.div>
            ))}

          {isMobile && (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeChapter}
                className="story-chapter story-chapter--active"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
              >
                <span className="story-step">
                  {CHAPTERS[activeChapter].tag}
                </span>
                <h3>{CHAPTERS[activeChapter].title}</h3>
                <p>{CHAPTERS[activeChapter].description}</p>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <div className="story-sticky">
          <div className="story-panel story-panel--chat">
            <div className="story-panel-header">
              <span>{CHAT_PANEL_HEADERS[activeChapter]}</span>
            </div>
            <div className="story-panel-body">
              <ChatPanelBody chapter={activeChapter} />
            </div>
          </div>

          <div className="story-panel story-panel--workspace">
            <div className="story-panel-header">
              <span>{WORKSPACE_PANEL_HEADERS[activeChapter]}</span>
            </div>
            <div className="story-tabs">
              {WORKSPACE_TABS.map((tab, i) => (
                <span
                  key={tab}
                  className={`story-tab ${activeChapter === i ? 'story-tab--active' : ''}`}
                >
                  {tab}
                </span>
              ))}
            </div>
            <div className="story-panel-body">
              <WorkspacePanelBody chapter={activeChapter} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
