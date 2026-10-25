import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { date, fill } from "./format.js";

/*
 * "Save as draft" for unfinished work (POS cart, invoice, purchase, stock entry, transfer, new product).
 * Drafts are stored on the server for the signed-in user, so they can be continued later or on another device.
 *
 *   const draft = useDraft("invoice");
 *   <DraftBar draft={draft} getData={() => ({ f, lines })} title="Hayat Market · $120" canSave={lines.length > 0}
 *             onLoad={(data) => { setF(data.f); setLines(data.lines); }} />
 *   after the real form is submitted:  draft.finish()   (deletes the draft that was being continued)
 */
export function useDraft(module) {
  const [list, setList] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const reload = useCallback(async () => {
    try { setList((await apiRequest(`/api/drafts?module=${module}`)).drafts || []); } catch { setList([]); }
  }, [module]);
  useEffect(() => { reload(); }, [reload]);

  const save = async (title, data) => {
    if (currentId) await apiRequest(`/api/drafts/${currentId}`, { method: "PUT", body: { module, title, data } });
    else setCurrentId((await apiRequest("/api/drafts", { method: "POST", body: { module, title, data } })).id);
    await reload();
  };
  const remove = async (draftId) => {
    await apiRequest(`/api/drafts/${draftId}`, { method: "DELETE" });
    if (draftId === currentId) setCurrentId(null);
    await reload();
  };
  /* the real form was submitted: the draft it came from is no longer needed */
  const finish = async () => {
    if (currentId) { try { await apiRequest(`/api/drafts/${currentId}`, { method: "DELETE" }); } catch { /* already gone */ } }
    setCurrentId(null);
    reload();
  };
  return { list, currentId, setCurrentId, save, remove, finish, reload };
}

export function DraftBar({ draft, getData, title, canSave = true, onLoad, compact = false }) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);    // "saving" | "saved" | "error"
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const save = async () => {
    setState("saving");
    try { await draft.save(title || t("ui.drafts.untitled"), getData()); setState("saved"); setTimeout(() => setState(null), 2500); }
    catch { setState("error"); }
  };
  const load = (d) => { draft.setCurrentId(d.id); onLoad(d.data); setOpen(false); };

  return (
    <div className={"draftbar" + (compact ? " draftbar--compact" : "")} ref={boxRef}>
      <button type="button" className="btn btn--outline btn--sm" disabled={!canSave || state === "saving"} onClick={save}
        title={draft.currentId ? t("ui.drafts.updateHint") : t("ui.drafts.saveHint")}>
        <Icon name={state === "saved" ? "check" : "download"} />
        <span>{state === "saving" ? t("ui.common.saving") : state === "saved" ? t("ui.drafts.saved") : draft.currentId ? t("ui.drafts.update") : t("ui.drafts.save")}</span>
      </button>
      <button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!draft.list.length && !open}>
        <Icon name="history" /><span>{fill(t("ui.drafts.list"), { n: draft.list.length })}</span>
      </button>
      {state === "error" && <span className="draftbar__error">{t("ui.errors.failed")}</span>}
      {open && (
        <div className="draftbar__panel" role="dialog" aria-label={t("ui.drafts.title")}>
          <p className="draftbar__head">{t("ui.drafts.title")}</p>
          {draft.list.length === 0 ? <p className="muted">{t("ui.drafts.none")}</p> : (
            <ul>
              {draft.list.map((d) => (
                <li key={d.id} className={d.id === draft.currentId ? "is-current" : ""}>
                  <button type="button" className="draftbar__open" onClick={() => load(d)}>
                    <strong>{d.title}</strong>
                    <small>{date(d.updatedAt, lang, true)}{d.id === draft.currentId ? ` · ${t("ui.drafts.open")}` : ""}</small>
                  </button>
                  <button type="button" className="icon-btn" onClick={() => draft.remove(d.id)} aria-label={t("ui.common.delete")}><Icon name="trash" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
