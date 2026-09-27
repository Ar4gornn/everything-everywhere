import { useNavigate } from "react-router-dom";

import { useT } from "../i18n";
import { Card } from "./ui";

/** Settings' way into the Invites page (AD-54). Rendered for an admin only. */
export function InvitesCard() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <Card title={t("invites.settingsTitle")}>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        {t("invites.settingsHint")}
      </p>
      <button type="button" className="quiet" onClick={() => navigate("/invites")}>
        {t("invites.open")}
      </button>
    </Card>
  );
}
