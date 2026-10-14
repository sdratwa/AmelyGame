export function FrogLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="18" cy="20" r="11" fill="#2e9e44" />
      <circle cx="46" cy="20" r="11" fill="#2e9e44" />
      <ellipse cx="32" cy="38" rx="25" ry="20" fill="#3cc058" />
      <circle cx="18" cy="20" r="7" fill="#fff" />
      <circle cx="46" cy="20" r="7" fill="#fff" />
      <circle cx="19" cy="21" r="3.6" fill="#111" />
      <circle cx="45" cy="21" r="3.6" fill="#111" />
      <path d="M17 42 Q32 54 47 42" stroke="#14532d" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="36" r="1.6" fill="#14532d" />
      <circle cx="40" cy="36" r="1.6" fill="#14532d" />
    </svg>
  );
}


export function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 64" className={className} aria-hidden>
      <rect x="2" y="2" width="36" height="60" rx="7" fill="#1f2937" stroke="#94a3b8" strokeWidth="2" />
      <rect x="6" y="9" width="28" height="42" rx="2" fill="#38bdf8" />
      <rect x="9" y="13" width="22" height="4" rx="1" fill="#e0f2fe" opacity={0.9} />
      <rect x="9" y="21" width="14" height="3" rx="1" fill="#e0f2fe" opacity={0.7} />
      <circle cx="20" cy="57" r="2" fill="#94a3b8" />
    </svg>
  );
}
