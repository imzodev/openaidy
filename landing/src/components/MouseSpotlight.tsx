import { useEffect, useRef } from 'react';

export default function MouseSpotlight() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let mx = -1000,
      my = -1000;
    let targetX = mx,
      targetY = my;
    let rafId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    window.addEventListener('mousemove', onMove, { passive: true });

    const draw = () => {
      // Smooth toward target
      targetX += (mx - targetX) * 0.12;
      targetY += (my - targetY) * 0.12;

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Radial gradient spotlight
      const grad = ctx!.createRadialGradient(
        targetX,
        targetY,
        0,
        targetX,
        targetY,
        700,
      );
      grad.addColorStop(0, 'rgba(99, 102, 241, 0.07)');
      grad.addColorStop(0.4, 'rgba(168, 85, 247, 0.04)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx!.fillStyle = grad;
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      // Subtle bright center
      const inner = ctx!.createRadialGradient(
        targetX,
        targetY,
        0,
        targetX,
        targetY,
        180,
      );
      inner.addColorStop(0, 'rgba(255, 255, 255, 0.04)');
      inner.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx!.fillStyle = inner;
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return <canvas ref={canvasRef} className="mouse-spotlight" />;
}
