// components/logo-icon.tsx

export function LogoIcon({ size = 22 }: { size?: number }) {
  // Пропорции рассчитаны от базового размера 22px
  const scale = size / 22;
  const r = 5 * scale;         // border-radius
  const barW = 3.5 * scale;    // ширина столбика
  const gap = 2 * scale;       // зазор между столбиками
  const pad = 4 * scale;       // padding
  const barR = 1.5 * scale;    // скругление столбика
  const heights = [11 * scale, 8 * scale, 5 * scale];

  const totalBarsW = barW * 3 + gap * 2;
  const startX = (size - totalBarsW) / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width={size} height={size} rx={r} fill="#10b981" />
      {heights.map((h, i) => (
        <rect
          key={i}
          x={startX + i * (barW + gap)}
          y={pad}
          width={barW}
          height={h}
          rx={barR}
          fill="white"
        />
      ))}
    </svg>
  );
}
