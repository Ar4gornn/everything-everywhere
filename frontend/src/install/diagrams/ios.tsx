import { useT } from "../../i18n";
import { AddressBar, Diagram, Dots, PillButton, Ring, Row, ShareGlyph } from "./parts";

/** iOS 26 Safari: the ⋯ button sits beside the address bar in the bottom bar. */
export function IosMenuButton() {
  return (
    <Diagram label="installGuide.dia.menuBottom">
      <AddressBar x={16} y={84} w={130} />
      <Dots cx={166} cy={92} vertical={false} />
      <Ring cx={166} cy={92} />
    </Diagram>
  );
}

/** The share list, "Add to Home Screen" being the row to tap. */
export function IosShareSheet() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.shareSheet">
      <Row y={14} label={t("installGuide.lbl.share")} />
      <Row y={38} label={t("installGuide.lbl.addToHome")} hi />
      <Row y={62} label="…" />
    </Diagram>
  );
}

/** The add dialog, with "Open as Web App" switched on. */
export function IosWebAppToggle() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.webAppToggle">
      <Row y={14} label="EEwhere" />
      <rect className="dia-line dia-hi" x="20" y="44" width="160" height="22" rx="4" />
      <text className="dia-text" x="28" y="58.5">
        {t("installGuide.lbl.openWebApp")}
      </text>
      <rect className="dia-line dia-on" x="146" y="48" width="28" height="14" rx="7" />
      <circle className="dia-knob" cx="167" cy="55" r="5" />
      <Ring cx={160} cy={55} r={15} />
    </Diagram>
  );
}

/** The add dialog, "Add" being the button to tap. */
export function IosAddButton() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.addButton">
      <Row y={14} label="EEwhere" />
      <Row y={38} label="…" />
      <PillButton x={110} y={76} w={70} label={t("installGuide.lbl.add")} hi />
    </Diagram>
  );
}

/** Older Safari (iOS 16.4–18): the Share button in the bottom bar. */
export function IosShareBottom() {
  return (
    <Diagram label="installGuide.dia.shareBottom">
      <line className="dia-line" x1="2" y1="76" x2="198" y2="76" />
      <ShareGlyph cx={100} cy={92} />
      <Ring cx={100} cy={91} />
    </Diagram>
  );
}

/** Chrome / Edge / Firefox on iPhone: Share in the address bar. */
export function IosShareTop() {
  return (
    <Diagram label="installGuide.dia.shareTop">
      <AddressBar x={16} y={14} w={140} />
      <ShareGlyph cx={176} cy={22} />
      <Ring cx={176} cy={21} />
    </Diagram>
  );
}
