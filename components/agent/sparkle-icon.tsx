/**
 * Четырёхлучевая искра с вогнутыми лучами — узнаваемый значок ИИ.
 *
 * Своя, а не `Sparkles` из lucide: там три звезды в обводке, и на 12–14px
 * они превращаются в кашу. Здесь одна фигура заливкой, читается на любом размере.
 */
export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 0c0 6.627 5.373 12 12 12-6.627 0-12 5.373-12 12 0-6.627-5.373-12-12-12 6.627 0 12-5.373 12-12Z" />
    </svg>
  );
}
