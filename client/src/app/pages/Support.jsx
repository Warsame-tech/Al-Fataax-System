import { useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, useApi, useSubmit, Modal, Field, FormError, EmptyState, Loading } from "../ui.jsx";
import { date, fill } from "../format.js";

/*
 * Help & support (routes/support.js): the business asks Faatix for help and sees the answers.
 * Any user can open a ticket; the business's tickets are shared by its staff. Faatix answers in the super admin area.
 */
export default function Support() {
  const { t, lang } = useLanguage();
  const list = useApi("/api/support/tickets");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(null);
  const rows = list.data?.tickets || [];
  return (
    <div className="page">
      <PageHeader icon="message" title={t("app.modules.support")} actions={<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}><Icon name="plus" /><span>{t("ui.helpdesk.new")}</span></button>} />
      <p className="page-help"><Icon name="info" /> {t("ui.helpdesk.help")}</p>
      {list.loading && !list.data ? <Loading /> : rows.length === 0 ? <EmptyState icon="message" text={t("ui.helpdesk.empty")} /> : (
        <ul className="ticket-list">
          {rows.map((x) => (
            <li key={x.id}>
              <button type="button" className={`ticket-row is-${x.status}${x.lastReplyBy === "admin" && x.status === "answered" ? " is-answered-new" : ""}`} onClick={() => setOpen(x.id)}>
                <span className={`ticket-row__prio is-${x.priority}`} />
                <span className="ticket-row__main"><strong>{x.subject}</strong><small>{x.user || "—"} · {date(x.updatedAt, lang, true)}</small></span>
                <span className="ticket-row__side">
                  <span className={`badge-status badge-status--${x.status === "closed" ? "cancelled" : x.status === "answered" ? "paid" : "partially_paid"}`}>{t(`ui.helpdesk.statuses.${x.status}`)}</span>
                  <small>{fill(t("ui.support.replies"), { n: x.replies })}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {creating && <NewTicket onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); list.reload(); setOpen(id); }} />}
      {open && <Thread id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}

function NewTicket({ onClose, onDone }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ subject: "", body: "", priority: "normal" });
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); const r = await sub.run(() => apiRequest("/api/support/tickets", { method: "POST", body: f })); if (r) onDone(r.id); };
  return (
    <Modal title={t("ui.helpdesk.new")} onClose={onClose} wide>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.helpdesk.subject")} error={sub.fieldErrors.subject}><input className="input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={160} placeholder={t("ui.helpdesk.subjectPh")} /></Field>
        <Field label={t("ui.helpdesk.message")} error={sub.fieldErrors.body}><textarea className="input" rows="5" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={t("ui.helpdesk.messagePh")} /></Field>
        <Field label={t("ui.helpdesk.priority")}><div className="seg">{["low", "normal", "high"].map((p) => <button key={p} type="button" aria-pressed={f.priority === p} onClick={() => setF({ ...f, priority: p })}>{t(`ui.support.priority.${p}`)}</button>)}</div></Field>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}><Icon name="arrow-right" /><span>{t("ui.support.send")}</span></button></div>
      </form>
    </Modal>
  );
}

function Thread({ id, onClose }) {
  const { t, lang } = useLanguage();
  const d = useApi(`/api/support/tickets/${id}`);
  const [body, setBody] = useState("");
  const sub = useSubmit();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [d.data]);
  const reply = async (e) => { e.preventDefault(); if (!body.trim()) return; if (await sub.run(() => apiRequest(`/api/support/tickets/${id}/reply`, { method: "POST", body: { body } }))) { setBody(""); d.reload(); } };
  const close = async () => { await apiRequest(`/api/support/tickets/${id}/close`, { method: "POST" }); onClose(); };
  const tk = d.data?.ticket;
  return (
    <Modal title={tk?.subject || "…"} onClose={onClose} wide>
      {!d.data ? <Loading /> : (
        <div className="thread">
          <ol className="thread__msgs">
            {d.data.messages.map((x) => (
              <li key={x.id} className={`thread__msg is-${x.author === "admin" ? "admin" : "business"}`}>
                <span className="thread__who">{x.author === "admin" ? <><Icon name="shield-check" /> Faatix</> : x.name} · {date(x.at, lang, true)}</span>
                <p>{x.body}</p>
              </li>
            ))}
            <li ref={end} aria-hidden="true" />
          </ol>
          <form onSubmit={reply} className="thread__reply">
            <textarea className="input" rows="3" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("ui.support.replyPh")} />
            <FormError error={sub.formError} />
            <div className="form-actions">
              {tk.status !== "closed" && <button type="button" className="btn btn--outline" onClick={close}>{t("ui.helpdesk.solved")}</button>}
              <button type="submit" className="btn btn--primary" disabled={sub.busy || !body.trim()}><Icon name="arrow-right" /><span>{t("ui.support.send")}</span></button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

/* Notices from Faatix (Super admin → Announcements), shown at the top of the app; each can be hidden on this device */
export function AnnouncementBar() {
  const { t } = useLanguage();
  const d = useApi("/api/support/announcements");
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem("faatix.hiddenAnnouncements") || "[]"); } catch { return []; } });
  const hide = (id) => { const next = [...hidden, id].slice(-50); setHidden(next); try { localStorage.setItem("faatix.hiddenAnnouncements", JSON.stringify(next)); } catch { /* not kept */ } };
  const items = (d.data?.announcements || []).filter((a) => !hidden.includes(a.id));
  if (!items.length) return null;
  return (
    <div className="ann-bar">
      {items.map((a) => (
        <div key={a.id} className={`ann-bar__item is-${a.level}`} role="status">
          <Icon name={a.level === "warning" ? "alert" : a.level === "success" ? "check" : "info"} />
          <span><strong>{a.title}</strong> {a.body}</span>
          <button type="button" className="ann-bar__x" onClick={() => hide(a.id)} aria-label={t("ui.common.close")}><Icon name="x" /></button>
        </div>
      ))}
    </div>
  );
}
