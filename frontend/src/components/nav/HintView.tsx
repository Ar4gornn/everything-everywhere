import type { NavHint } from "../../nav/hints";
import { MoonGlyph } from "../MoonGlyph";

/**
 * A live hint as the drawer tile and the sidebar draw it: the words, and for the moon the
 * app's own `MoonGlyph` (right hemisphere, decorative: the words carry the meaning) before
 * them. The words are their own span so the container can ellipsise or line-clamp them.
 */
export function HintView({ hint, className }: { hint: NavHint; className: string }) {
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
