import { useEffect, useState } from 'react';
import { motion, useSpring } from 'framer-motion';

export default function CustomCursor() {
  const cursorX = useSpring(0, { stiffness: 2000, damping: 70 });
  const cursorY = useSpring(0, { stiffness: 2000, damping: 70 });
  const dotX = useSpring(0, { stiffness: 5000, damping: 50 });
  const dotY = useSpring(0, { stiffness: 5000, damping: 50 });
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      cursorX.set(e.clientX - 10);
      cursorY.set(e.clientY - 10);
      dotX.set(e.clientX - 4);
      dotY.set(e.clientY - 4);
    };

    const over = (e: MouseEvent) => {
      const target = e.target as Element;
      const isInteractive =
        target.closest('a, button, .feature-card, .magnetic') !== null;
      setIsHovering(isInteractive);
    };

    window.addEventListener('mousemove', move, { passive: true });
    window.addEventListener('mouseover', over, { passive: true });
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseover', over);
    };
  }, [cursorX, cursorY, dotX, dotY]);

  return (
    <>
      {/* Outer ring — lags behind */}
      <motion.div
        className="cursor-outer"
        style={{ x: cursorX, y: cursorY }}
        animate={{ scale: isHovering ? 2.5 : 1 }}
        transition={{ scale: { stiffness: 300, damping: 25 } }}
      />
      {/* Inner dot — follows tightly */}
      <motion.div
        className="cursor-dot"
        style={{ x: dotX, y: dotY }}
        animate={{ scale: isHovering ? 2 : 1 }}
        transition={{ scale: { stiffness: 500, damping: 30 } }}
      />
    </>
  );
}
