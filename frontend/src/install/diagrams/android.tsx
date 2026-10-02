import { useT } from "../../i18n";
import { AddressBar, Diagram, Dots, PillButton, Ring, Row } from "./parts";

/** Any Android browser: the ⋮ menu at the top right. */
export function AndroidMenuButton() {
  return (
    <Diagram label="installGuide.dia.androidMenu">
      <AddressBar x={16} y={14} w={140} />
      <Dots cx={176} cy={22} vertical />
      <Ring cx={176} cy={22} />
    </Diagram>
  );
}

/** Chrome / Edge menu: "Install app" is the row to tap. */
export function AndroidMenuList() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.androidList">
      <Row y={12} label="…" />
      <Row y={36} x={12} w={176} label={t("installGuide.lbl.installApp")} hi />
      <Row y={60} label="…" />
    </Diagram>
  );
}

/** Firefox: the ⋮ menu at the top right. */
export function AndroidFirefoxMenuButton() {
  return (
    <Diagram label="installGuide.dia.androidFirefoxMenu">
      <AddressBar x={16} y={14} w={140} />
      <Dots cx={176} cy={22} vertical />
      <Ring cx={176} cy={22} />
    </Diagram>
  );
}

/** Firefox menu: "Install" is the row to tap. */
export function AndroidFirefoxList() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.menuFirefox">
      <Row y={12} label="…" />
      <Row y={36} label={t("installGuide.lbl.install")} hi />
      <Row y={60} label="…" />
    </Diagram>
  );
}

/** Firefox's confirmation box: a plain "Add" pill, drawn in the Android style. */
export function AndroidFirefoxConfirm() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.androidFirefoxConfirm">
      <Row y={14} label="EEwhere" />
      <PillButton x={110} y={76} w={70} label={t("installGuide.lbl.add")} hi />
    </Diagram>
  );
}

/** The browser's confirmation box. */
export function AndroidConfirm() {
  const t = useT();
  return (
    <Diagram label="installGuide.dia.androidConfirm">
      <Row y={14} label="EEwhere" />
      <PillButton x={110} y={76} w={70} label={t("installGuide.lbl.install")} hi />
    </Diagram>
  );
}
