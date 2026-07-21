import { useEffect, useState } from 'react';

type Mode = 'typing' | 'holding' | 'erasing' | 'pausing';

export function TypewriterText({
  phrases,
  start,
  className,
  typeSpeed = 60,
  holdMs = 1400,
  eraseSpeed = 30,
  pauseMs = 250,
}: {
  phrases: string[];
  start: boolean;
  className?: string;
  typeSpeed?: number;
  holdMs?: number;
  eraseSpeed?: number;
  pauseMs?: number;
}) {
  const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a), '');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [mode, setMode] = useState<Mode>('typing');

  useEffect(() => {
    if (!start) return;
    const phrase = phrases[phraseIdx];
    if (!phrase) return;

    let timer: ReturnType<typeof setTimeout>;

    switch (mode) {
      case 'typing':
        if (displayed.length < phrase.length) {
          timer = setTimeout(
            () => setDisplayed(phrase.slice(0, displayed.length + 1)),
            typeSpeed,
          );
        } else {
          // Defer the transition so we don't call setState synchronously in
          // the effect body (matches the other deferred branches).
          timer = setTimeout(() => setMode('holding'), 0);
        }
        break;
      case 'holding':
        timer = setTimeout(() => setMode('erasing'), holdMs);
        break;
      case 'erasing':
        if (displayed.length > 0) {
          timer = setTimeout(
            () => setDisplayed(displayed.slice(0, -1)),
            eraseSpeed,
          );
        } else {
          // Defer the transition (see 'typing' branch above).
          timer = setTimeout(() => setMode('pausing'), 0);
        }
        break;
      case 'pausing':
        timer = setTimeout(() => {
          setPhraseIdx((phraseIdx + 1) % phrases.length);
          setMode('typing');
        }, pauseMs);
        break;
    }

    return () => clearTimeout(timer);
  }, [
    start,
    mode,
    displayed,
    phraseIdx,
    phrases,
    typeSpeed,
    holdMs,
    eraseSpeed,
    pauseMs,
  ]);

  return (
    <span className="typewriter">
      <span className="typewriter-ghost" aria-hidden="true">
        {longest}
      </span>
      <span
        className={`typewriter-live${className ? ` ${className}` : ''}`}
        aria-live="polite"
      >
        {displayed}
        <span className="cursor" />
      </span>
    </span>
  );
}
