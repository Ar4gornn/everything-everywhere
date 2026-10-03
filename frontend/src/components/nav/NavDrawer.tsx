import type { NavModel } from "../../nav/model";

/**
 * Epic 52 (AD-65): the More drawer on a phone — a native modal `<dialog>` bottom sheet (the
 * app's modal pattern since AD-60) with one tile per place not pinned to the bar, grouped,
 * each with icon, name and live hint (`useNavHints`), then Settings last. Closes on a tile
 * tap, Escape, the close button and a backdrop tap; focus returns to More.
 * SKELETON: builder A implements.
 */
export function NavDrawer(_props: { model: NavModel; open: boolean; onClose: () => void }) {
  return null;
}
