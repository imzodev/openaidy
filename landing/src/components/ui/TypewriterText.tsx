import { useEffect, useState } from 'react';

export function TypewriterText({
  text,
  start,
}: {
  text: string;
  start: boolean;
}) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    if (!start) return;
    let i = 0;
    const t = setInterval(() => {
      setDisplayed(text.slice(0, i + 1));
      i++;
      if (i >= text.length) clearInterval(t);
    }, 50);
    return () => clearInterval(t);
  }, [start, text]);
  return (
    <span>
      {displayed}
      <span className="cursor" />
    </span>
  );
}
