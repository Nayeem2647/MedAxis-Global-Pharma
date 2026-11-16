export function HeroArtwork() {
  return <svg className="hero-artwork" viewBox="0 0 1440 580" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="medaxis-foil" x1="0" y1="0" x2="200" y2="300" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--color-surface)"/><stop offset=".5" stopColor="var(--color-pastel-blue)"/><stop offset="1" stopColor="var(--color-surface)"/>
      </linearGradient>
      <linearGradient id="medaxis-glass" x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
        <stop stopColor="var(--color-surface)" stopOpacity=".85"/><stop offset=".5" stopColor="var(--color-brand)" stopOpacity=".2"/><stop offset="1" stopColor="var(--color-surface)" stopOpacity=".75"/>
      </linearGradient>
      <filter id="medaxis-art-shadow" x="-40%" y="-40%" width="190%" height="190%"><feDropShadow dx="4" dy="12" stdDeviation="10" floodColor="var(--color-ink)" floodOpacity=".12"/></filter>
    </defs>
    <g transform="translate(1230 -40) rotate(28)" filter="url(#medaxis-art-shadow)">
      <rect width="205" height="310" rx="19" fill="url(#medaxis-foil)" stroke="var(--color-surface)" strokeWidth="2"/>
      {[0, 1, 2, 3].map((row) => [0, 1].map((column) => <g key={`${row}-${column}`} transform={`translate(${25 + column * 92} ${24 + row * 72})`}>
        <rect width="64" height="48" rx="24" fill="var(--color-page)" stroke="var(--color-border)" strokeWidth="2"/>
        <rect x="8" y="11" width="48" height="25" rx="12.5" fill="var(--color-surface)"/>
        <path d="M32 11h11a12.5 12.5 0 0 1 0 25H32z" fill="var(--color-brand)"/>
        <path d="M32 12v23" stroke="var(--color-action)" strokeOpacity=".25"/>
      </g>))}
    </g>
    <g transform="translate(-115 370) rotate(-26)" opacity=".65">
      <rect width="225" height="305" rx="20" fill="url(#medaxis-foil)"/>
      {[0, 1, 2].map((row) => [0, 1].map((column) => <g key={`${row}-${column}`} transform={`translate(${32 + column * 95} ${30 + row * 90})`}>
        <rect width="62" height="62" rx="31" fill="var(--color-surface)" stroke="var(--color-border)"/>
        <path d="M18 32h26" stroke="var(--color-action)" strokeOpacity=".3" strokeWidth="2"/>
      </g>))}
    </g>
    <g transform="translate(1260 330) rotate(18)" filter="url(#medaxis-art-shadow)">
      <rect x="15" width="81" height="34" rx="6" fill="var(--color-action)"/>
      <path d="M27 7v20M39 7v20M51 7v20M63 7v20M75 7v20M87 7v20" stroke="var(--color-surface)" strokeOpacity=".25" strokeWidth="3"/>
      <path d="M29 34h53v16c0 12 23 17 23 38v112c0 13-8 21-21 21H27c-13 0-21-8-21-21V88c0-21 23-26 23-38z" fill="url(#medaxis-glass)" stroke="var(--color-surface)" strokeWidth="3"/>
      <rect x="10" y="98" width="91" height="75" rx="5" fill="var(--color-surface)"/>
      <path d="M47 118v35M29.5 135.5h35" stroke="var(--color-brand)" strokeWidth="8" strokeLinecap="round"/>
      <path d="M21 83v108" stroke="var(--color-surface)" strokeWidth="4" strokeLinecap="round"/>
    </g>
    <g transform="translate(1150 486) rotate(-30)" filter="url(#medaxis-art-shadow)">
      <rect width="96" height="35" rx="17.5" fill="var(--color-surface)"/>
      <path d="M48 0h30.5a17.5 17.5 0 0 1 0 35H48z" fill="var(--color-action)"/>
      <path d="M48 1v33" stroke="var(--color-border)"/>
    </g>
  </svg>;
}
