import { useState } from "react";

import type { CardId, LayoutName, ModuleId, NavItemId, PreferencesPatch } from "../api/types";
import { useT } from "../i18n";
import { CARD_LABEL, CARD_MODULE, MODULE_NAME } from "../layout/modules";
import {
  DEFAULT_PREFERENCES,
  LAYOUTS,
  MODULES,
  PHONE_PIN_CAP,
  itemsOf,
  moveCard,
  moveItem,
  pinItem,
  unpinItem,
} from "../layout/preferences";
import { NAV_DEFS, NAV_GROUPS } from "../nav/model";
import { usePreferences } from "../layout/useLayout";
import { Card, ErrorBanner } from "./ui";

/**
 * Settings → Layout (Epic 33): which modules the account uses, and where each section sits
 * in each of its two layouts. Every change applies at once and is saved in the background;
 * a save that fails is undone and says so here, not in a page-wide banner.
 *
 * Up and down buttons rather than drag and drop (the interview's choice): they work the
 * same by touch, mouse and keyboard, and each one says in words what it will do.
 */
export function LayoutCard() {
  const t = useT();
  const { preferences, layout, update } = usePreferences();
  const [failed, setFailed] = useState(false);
  // The layout this screen uses opens first; the other is one tap away, editable from here.
  const [editing, setEditing] = useState<LayoutName>(layout);
  const [confirming, setConfirming] = useState(false);

  function save(patch: PreferencesPatch) {
    setFailed(false);
    update(patch).catch(() => setFailed(true));
  }

  function setModule(id: ModuleId, on: boolean) {
    save({ modules: { ...preferences.modules, [id]: on } });
  }

  const current = preferences[editing];
  const items = itemsOf(current);
  const setItems = (next: typeof items) => save({ [editing]: { ...current, items: next } });
  const placeName = (id: NavItemId) => t(NAV_DEFS[id].label);
  const isOff = (id: NavItemId) => {
    const module = NAV_DEFS[id].module;
    return module ? !preferences.modules[module] : false;
  };
  const pinnedCount = items.filter((item) => item.pinned).length;
  const barFull = pinnedCount >= PHONE_PIN_CAP;
  const onPhone = editing === "phone";

  /** A desktop has no bar: order within a group is over every place, pinned or not, so the
   *  move is made on a copy with nothing pinned and the pins are put back after. */
  function move(id: NavItemId, step: -1 | 1) {
    if (onPhone) return setItems(moveItem(items, id, step));
    const moved = moveItem(
      items.map((item) => ({ id: item.id, pinned: false })),
      id,
      step,
    );
    const pinnedBefore = new Map(items.map((item) => [item.id, item.pinned]));
    setItems(moved.map((item) => ({ id: item.id, pinned: pinnedBefore.get(item.id) ?? false })));
  }

  /** One place: its name, up and down within its own list, and pin or unpin on a phone. */
  function placeRow(id: NavItemId, index: number, count: number) {
    const pinned = items.find((item) => item.id === id)?.pinned ?? false;
    const name = placeName(id);
    return (
      <li key={id} className="row" style={{ alignItems: "center", gap: 6, margin: "4px 0" }}>
        <span style={{ flex: "1 1 auto", minWidth: 0 }} className={isOff(id) ? "hint" : undefined}>
          {name}
          {isOff(id) && <span> {t("layout.nav.off")}</span>}
        </span>
        <button
          type="button"
          className="quiet"
          aria-label={t("layout.up", { name })}
          disabled={index === 0}
          onClick={() => move(id, -1)}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className="quiet"
          aria-label={t("layout.down", { name })}
          disabled={index === count - 1}
          onClick={() => move(id, 1)}
        >
          <span aria-hidden="true">↓</span>
        </button>
        {onPhone &&
          (pinned ? (
            <button
              type="button"
              className="quiet"
              aria-label={t("layout.nav.unpin", { name })}
              onClick={() => setItems(unpinItem(items, id))}
            >
              <span aria-hidden="true">⤓</span>
            </button>
          ) : (
            <button
              type="button"
              className="quiet"
              aria-label={t("layout.nav.pin", { name })}
              aria-describedby={barFull ? "layout-nav-full" : undefined}
              disabled={barFull}
              onClick={() => setItems(pinItem(items, id))}
            >
              <span aria-hidden="true">⤒</span>
            </button>
          ))}
      </li>
    );
  }

  const bar = items.filter((item) => item.pinned);
  // A phone's groups hold what is not in the bar; a desktop's hold every place.
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    ids: items
      .filter((item) => NAV_DEFS[item.id].group === group.id && (!onPhone || !item.pinned))
      .map((item) => item.id),
  })).filter((group) => group.ids.length > 0);

  const setCards = (next: typeof current.cards) => save({ [editing]: { ...current, cards: next } });
  const cardName = (id: CardId) => t(CARD_LABEL[id]);

  function cardRow(card: (typeof current.cards)[number], index: number) {
    const module = CARD_MODULE[card.id];
    const off = module ? !preferences.modules[module] : false;
    return (
      <li key={card.id} className="row" style={{ alignItems: "center", gap: 6, margin: "4px 0" }}>
        {off && module ? (
          // Its module is off: no switch to offer, and the place is kept for when it is back.
          <span style={{ flex: "1 1 auto", minWidth: 0 }} className="hint">
            {cardName(card.id)} · {t("module.offTitle", { name: t(MODULE_NAME[module]) })}
          </span>
        ) : (
          <label className="check" style={{ flex: "1 1 auto", minWidth: 0 }}>
            <input
              type="checkbox"
              aria-label={t("layout.show", { name: cardName(card.id) })}
              checked={card.on}
              onChange={(event) =>
                setCards(
                  current.cards.map((c) =>
                    c.id === card.id ? { ...c, on: event.target.checked } : c,
                  ),
                )
              }
            />
            {cardName(card.id)}
          </label>
        )}
        <button
          type="button"
          className="quiet"
          aria-label={t("layout.up", { name: cardName(card.id) })}
          disabled={index === 0}
          onClick={() => setCards(moveCard(current.cards, card.id, -1))}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className="quiet"
          aria-label={t("layout.down", { name: cardName(card.id) })}
          disabled={index === current.cards.length - 1}
          onClick={() => setCards(moveCard(current.cards, card.id, 1))}
        >
          <span aria-hidden="true">↓</span>
        </button>
      </li>
    );
  }

  return (
    // The id is where a module's "turned off" page links to.
    <div id="layout">
      <Card title={t("layout.title")}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("layout.modules")}</legend>
          <div className="row" style={{ flexWrap: "wrap", gap: "6px 16px" }}>
            {MODULES.map((id) => (
              <label key={id} className="check" style={{ flex: "0 0 auto" }}>
                <input
                  type="checkbox"
                  checked={preferences.modules[id]}
                  onChange={(event) => setModule(id, event.target.checked)}
                />
                {t(MODULE_NAME[id])}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="hint" style={{ marginTop: 8 }}>
          {t("layout.modulesHint")}
        </p>

        <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>{t("layout.nav.title")}</h3>
        <div className="chips" role="group" aria-label={t("layout.nav.title")}>
          {LAYOUTS.map((name) => (
            <button
              key={name}
              type="button"
              className={`chip ${editing === name ? "on" : ""}`}
              aria-pressed={editing === name}
              onClick={() => {
                setEditing(name);
                setConfirming(false);
              }}
            >
              {t(`layout.${name}`)}
            </button>
          ))}
        </div>
        <p className="hint">{t(onPhone ? "layout.nav.phoneHint" : "layout.nav.desktopHint")}</p>

        {onPhone && (
          <>
            <h4 style={{ margin: "10px 0 2px" }} id="layout-bar">
              {t("layout.nav.bar", { count: pinnedCount, max: PHONE_PIN_CAP })}
            </h4>
            {bar.length === 0 ? (
              <p className="hint" style={{ margin: "0 0 4px" }}>
                {t("layout.nav.barEmpty")}
              </p>
            ) : (
              <ol aria-labelledby="layout-bar" style={{ margin: 0, paddingLeft: 20 }}>
                {bar.map((item, index) => placeRow(item.id, index, bar.length))}
              </ol>
            )}
            {barFull && (
              <p className="hint" id="layout-nav-full" style={{ margin: "4px 0 0" }}>
                {t("layout.nav.full", { max: PHONE_PIN_CAP })}
              </p>
            )}
          </>
        )}
        {groups.map((group) => (
          <section key={group.id}>
            <h4 style={{ margin: "10px 0 2px" }} id={`layout-group-${group.id}`}>
              {t(group.label)}
            </h4>
            <ol aria-labelledby={`layout-group-${group.id}`} style={{ margin: 0, paddingLeft: 20 }}>
              {group.ids.map((id, index) => placeRow(id, index, group.ids.length))}
            </ol>
          </section>
        ))}

        <h4 style={{ margin: "14px 0 2px" }} id="layout-cards">
          {t("layout.cards")}
        </h4>
        <p className="hint" style={{ margin: "0 0 4px" }}>
          {t("layout.cardsHint")}
        </p>
        <ol aria-labelledby="layout-cards" style={{ margin: 0, paddingLeft: 20 }}>
          {current.cards.map((card, index) => cardRow(card, index))}
        </ol>

        <div className="row" style={{ marginTop: 12, alignItems: "center", gap: 8 }}>
          {confirming ? (
            <>
              <span>
                {t("layout.resetConfirm", { layout: t(`layout.${editing}`).toLowerCase() })}
              </span>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  save({ [editing]: DEFAULT_PREFERENCES[editing] });
                }}
              >
                {t("layout.resetYes")}
              </button>
              <button type="button" className="quiet" onClick={() => setConfirming(false)}>
                {t("action.cancel")}
              </button>
            </>
          ) : (
            <button type="button" className="quiet" onClick={() => setConfirming(true)}>
              {t("layout.reset")}
            </button>
          )}
        </div>
        {failed && <ErrorBanner message={t("layout.saveFailed")} />}
      </Card>
    </div>
  );
}
