import type { Entry } from "../catalogue";

/** Epic 48 (AD-64): Settings → Clocks and the calendar's "also in" zone. Builder S adds
 *  `clocks.settings.*` and `cal.alsoIn*` keys here. */
export const clocksSettings = {} satisfies Record<string, Entry>;
