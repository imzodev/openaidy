export function Marquee({
  children,
  speed = 40,
}: {
  children: React.ReactNode;
  speed?: number;
}) {
  return (
    <div className="marquee-track">
      <div
        className="marquee-content"
        style={{ animationDuration: `${speed}s` }}
      >
        {children}
        {children}
      </div>
    </div>
  );
}
