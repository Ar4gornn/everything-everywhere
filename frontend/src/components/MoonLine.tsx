import { useT } from "../i18n";
import type { MoonState } from "../moon/engine";
import type { Hemisphere } from "../moon/hemisphere";
import { MoonGlyph } from "./MoonGlyph";

/** The glyph, the phase name and how much is lit, as one run of text (Epic 47). */
export function MoonLine({
  state,
  hemisphere,
  size = 16,
}: {
  state: MoonState;
  hemisphere: Hemisphere;
  size?: number;
}) {
  const t = useT();
  const percent = Math.round(state.illumination * 100);
  return (
    <span className="moon-line">
      <MoonGlyph
        phase={state.phase}
        angle={state.angle}
        hemisphere={hemisphere}
        size={size}
        decorative
      />
      <span>
        {t(`moon.phase.${state.phase}`)} · {t("moon.lit", { percent })}
      </span>
    </span>
  );
}
