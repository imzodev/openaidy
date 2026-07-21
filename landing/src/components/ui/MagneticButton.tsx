import { useRef } from 'react';
import { motion, useMotionValue } from 'framer-motion';

export function MagneticButton({
  children,
  href,
  className,
}: {
  children: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    x.set((e.clientX - cx) * 0.2);
    y.set((e.clientY - cy) * 0.2);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ display: 'inline-block' }}
    >
      {href ? (
        <a href={href} className={className}>
          <motion.span
            style={{
              x,
              y,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            {children}
          </motion.span>
        </a>
      ) : (
        <motion.span
          style={{ x, y }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          {children}
        </motion.span>
      )}
    </motion.div>
  );
}
