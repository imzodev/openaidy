/**
 * The Aidy mark plus wordmark. The mark is the brand SVG; the name is live
 * text so it follows the theme and stays crisp at any size.
 */
export function BrandLogo({
  size = 22,
  showName = true,
}: {
  size?: number;
  showName?: boolean;
}) {
  return (
    <span className="brand-logo" style={{ fontSize: size * 0.95 }}>
      <img
        src="/brand/mark.svg"
        alt={showName ? '' : 'Aidy'}
        width={size}
        height={size}
        className="brand-logo-mark"
      />
      {showName && <span className="brand-logo-name">Aidy</span>}
    </span>
  );
}
