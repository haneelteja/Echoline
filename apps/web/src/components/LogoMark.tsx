// Ported from the original prototype's logo mark: a white dot with two
// broadcast-wave arcs in the brand's purple/green accent colors.
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="9" cy="17" r="5" fill="#fff" />
      <path d="M17 8a12 12 0 0 1 0 18" fill="none" stroke="#8B7CFF" strokeWidth={3} strokeLinecap="round" />
      <path d="M23 3.5a19 19 0 0 1 0 27" fill="none" stroke="#3CCB9A" strokeWidth={3} strokeLinecap="round" opacity={0.9} />
    </svg>
  );
}
