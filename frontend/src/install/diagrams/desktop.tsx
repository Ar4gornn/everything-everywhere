import { useT } from "../../i18n";
import { AddressBar, Diagram, PillButton, Ring, Row } from "./parts";

/** Chrome / Edge: the install icon at the right end of the address bar. */
export function DesktopInstallIcon() {
  return (
    <Diagram label="installGuide.dia.desktopIcon">
      <AddressBar x={16} y={14} w={168} />
      <g className="dia-line dia-nofill">
        <rect x="165" y="18" width="12" height="9" rx="1.5" />
        <path d="M171 13.5 v7 M168 18 l3 3 l3 -3" />
      </g>
      <Ring cx={171} cy={22} r={10} />
    </Diagram>
  );
}

/** The confirmation box on a computer. */
export function DesktopConfirm() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.desktopConfirm">
      <Row y={14} label="EEwhere" />
      <PillButton x={110} y={76} w={70} label={t("installGuide.lbl.install")} hi />
    </Diagram>
  );
}

/** Safari on a Mac: the File menu, "Add to Dock" being the row to tap. */
export function MacFileMenu() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.macFile">
      <text className="dia-text" x="14" y="20">
        {t("installGuide.lbl.file")}
      </text>
      <Row y={30} label="…" x={10} w={140} />
      <Row y={54} label={t("installGuide.lbl.addToDock")} hi x={10} w={140} />
    </Diagram>
  );
}

/** Safari on a Mac: the add dialog. */
export function MacAdd() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.macAdd">
      <Row y={14} label="EEwhere" />
      <PillButton x={110} y={76} w={70} label={t("installGuide.lbl.add")} hi />
    </Diagram>
  );
}
