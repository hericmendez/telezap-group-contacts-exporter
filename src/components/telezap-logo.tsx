interface TeleZapLogoProps {
  size?: number;
  className?: string;
}

/**
 * TeleZap mark: a compact geometric lightning bolt ("Zap") whose lower
 * terminal ends in a contact/connection node. Original artwork, inline SVG —
 * no third-party logos. Works on light and dark surfaces.
 */
export function TeleZapMark({ size = 32, className }: TeleZapLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="TeleZap"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="currentColor" opacity="0.14" />
      <path
        d="M37 10 L19 37 h11.5 L25 54 L45 29 h-12 L37 10 z"
        fill="currentColor"
      />
      <circle cx="46" cy="47" r="7.5" fill="currentColor" />
      <circle cx="46" cy="47" r="3" fill="var(--background, #fff)" />
    </svg>
  );
}

export function TeleZapWordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-bold tracking-tight">TeleZap</span>{" "}
      <span className="font-normal text-muted-foreground">Group Contacts Exporter</span>
    </span>
  );
}
