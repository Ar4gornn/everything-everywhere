import type { NavHint } from "../../nav/hints";
import { MoonGlyph } from "../MoonGlyph";

/**
 * A live hint as the drawer tile and the sidebar draw it: the words, and for the moon the
 * app's own `MoonGlyph` (right hemisphere, decorative: the words carry the meaning) before
 * them. The words are their own span so the container can ellipsise or line-clamp them.
 *
 * A clock hint comes in parts: the place's name is the one span that may be cut, and the
 * time (with "tomorrow"/"yesterday") is never cut, which is the reason anyone reads it.
 */
export function HintView({ hint, className }: { hint: NavHint; className: string }) {
  if (hint.clock) {
    const { label, time, day } = hint.clock;
    return (
      <span className={`${className} nav-hint-clock`}>
        <span className="nav-hint-label">{label}</span>{" "}
        <span className="nav-hint-time">{day ? `${time} ${day}` : time}</span>
      </span>
    );
  }
  return (
    <span className={className}>
      {hint.moon ? (
        <MoonGlyph
          phase={hint.moon.phase}
          angle={hint.moon.angle}
          hemisphere={hint.moon.hemisphere}
          illumination={hint.moon.illumination}
          size={14}
          decorative
        />
      ) : null}
      <span className="nav-hint-text">{hint.text}</span>
    </span>
  );
}
