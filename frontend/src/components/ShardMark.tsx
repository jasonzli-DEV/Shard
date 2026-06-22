/**
 * ShardMark — the crystal facet logomark.
 *
 * Three interlocking polygon faces that catch light differently:
 *   dark (shadow), mid (body), lit (accent highlight).
 * This is the single element that makes Shard unmistakable.
 */

interface ShardMarkProps {
  size?: number;
  className?: string;
}

export default function ShardMark({ size = 32, className }: ShardMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Shadow face — bottom-left */}
      <polygon
        points="4,44 22,8 22,30"
        fill="#1E2740"
      />
      {/* Mid face — right body */}
      <polygon
        points="22,8 44,36 22,44"
        fill="#2D4070"
      />
      {/* Lit face — top-right accent edge */}
      <polygon
        points="22,8 44,20 44,36"
        fill="#4A90D9"
      />
      {/* Thin bright edge line for crispness */}
      <line
        x1="22" y1="8"
        x2="44" y2="20"
        stroke="#6AABF0"
        strokeWidth="0.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
