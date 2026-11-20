import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { useApi, useSubmit, FormError, Loading, EmptyState, Modal } from "../app/ui.jsx";
import { date, fill } from "../app/format.js";

/*
 * Support: tickets the businesses open in the app (Help & support) and messages sent from the website.
 *   /admin/tickets[?status=waiting|open|answered|closed]   /admin/messages[?status=new|read|closed]
 */
export function Tickets({ can }) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const d = useApi(`/api/admin/tickets?status=${status}`);
  const [open, setOpen] = useState(null);
  return (
    <div className="page">
      <h1 className="admin-title">{t(`ui.support.ticketFilters.${status || "all"}`)}</h1>
      <div className="seg seg--tabs">
        {["waiting", "", "open", "answered", "closed"].map((s) => <button key={s} type="button" className={status === s ? "is-on" : ""} aria-pressed={status === s} onClick={() => setParams(s ? { status: s } : {})}>{t(`ui.support.ticketFilters.${s || "all"}`)}</button>)}
      </div>
      {!d.data ? <Loading /> : d.data.tickets.length === 0 ? <EmptyState icon="message" text={t("ui.support.noTickets")} /> : (
        <ul className="ticket-list">
          {d.data.tickets.map((x) => (
            <li key={x.id}>
              <button type="button" className={`ticket-row is-${x.status}${x.lastReplyBy === "business" && x.status !== "closed" ? " is-waiting" : ""}`} onClick={() => setOpen(x.id)}>
                <span className={`ticket-row__prio is-${x.priority}`} title={t(`ui.support.priority.${x.priority}`)} />
                <span className="ticket-row__main">
                  <strong>{x.subject}</strong>
                  <small>{x.business} · {x.user || "—"} · {date(x.updatedAt, lang, true)}</small>
                  <span className="ticket-row__last">{x.lastBody}</span>
                </span>
                <span className="ticket-row__side">
                  <span className={`badge-status badge-status--${x.status === "closed" ? "cancelled" : x.status === "answered" ? "paid" : "partially_paid"}`}>{t(`ui.support.statuses.${x.status}`)}</span>
                  <small>{fill(t("ui.support.replies"), { n: x.replies })}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <TicketThread id={open} can={can} onClose={() => { setOpen(null); d.reload(); }} />}
    </div>
  );
}

function TicketThread({ id, can, onClose }) {
  const { t, lang } = useLanguage();
  const d = useApi(`/api/admin/tickets/${id}`);
  const [body, setBody] = useState("");
  const sub = useSubmit();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [d.data]);
  const reply = async (close) => {
    if (!body.trim()) { sub.setFieldErrors({ body: "required" }); return; }
    if (await sub.run(() => apiRequest(`/api/admin/tickets/${id}/reply`, { method: "POST", body: { body, close } }))) { setBody(""); d.reload(); }
  };
  const setStatus = async (status) => { await apiRequest(`/api/admin/tickets/${id}`, { method: "PATCH", body: { status } }); d.reload(); };
  const tk = d.data?.ticket;
  return (
    <Modal title={tk ? tk.subject : "…"} onClose={onClose} wide>
      {!d.data ? <Loading /> : (
        <div className="thread">
          <p className="thread__meta"><Link to={`/admin/businesses/${tk.businessId}`}>{tk.business}</Link> · {tk.user || "—"} · {t(`ui.support.priority.${tk.priority}`)} · {t(`ui.support.statuses.${tk.status}`)}</p>
          <ol className="thread__msgs">
            {d.data.messages.map((x) => (
              <li key={x.id} className={`thread__msg is-${x.author}`}>
                <span className="thread__who">{x.name || "—"} · {date(x.at, lang, true)}</span>
                <p>{x.body}</p>
              </li>
            ))}
            <li ref={end} aria-hidden="true" />
          </ol>
          {can("support") && (
            <div className="thread__reply">
              <textarea className={"input" + (sub.fieldErrors.body ? " has-error" : "")} rows="3" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("ui.support.replyPh")} />
              <FormError error={sub.formError} />
              <div className="form-actions">
                {tk.status !== "closed" ? <button type="button" className="btn btn--outline" onClick={() => setStatus("closed")}>{t("ui.support.close")}</button>
                  : <button type="button" className="btn btn--outline" onClick={() => setStatus("open")}>{t("ui.support.reopen")}</button>}
                <button type="button" className="btn btn--outline" disabled={sub.busy} onClick={() => reply(true)}>{t("ui.support.replyClose")}</button>
                <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={() => reply(false)}><Icon name="arrow-right" /><span>{t("ui.support.send")}</span></button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function Messages({ can }) {
  const { t, lang } = useLanguage();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const d = useApi(`/api/admin/messages?status=${status}`);
  const [note, setNote] = useState({});
  const set = async (m, s) => { await apiRequest(`/api/admin/messages/${m.id}`, { method: "PATCH", body: { status: s, replyNote: note[m.id] ?? m.replyNote } }); d.reload(); };
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.admin.menu.messages")}</h1>
      <div className="seg seg--tabs">
        {["new", "", "read", "closed"].map((s) => <button key={s} type="button" className={status === s ? "is-on" : ""} aria-pressed={status === s} onClick={() => setParams(s ? { status: s } : {})}>{t(`ui.support.msgFilters.${s || "all"}`)}</button>)}
      </div>
      {!d.data ? <Loading /> : d.data.messages.length === 0 ? <EmptyState icon="mail" text={t("ui.support.noMessages")} /> : (
        <div className="msg-cards">
          {d.data.messages.map((x) => (
            <article key={x.id} className={`msg-card is-${x.status}`}>
              <header>
                <strong>{x.name}{x.business && <span className="muted"> · {x.business}</span>}</strong>
                <span className="muted">{date(x.createdAt, lang, true)}</span>
                <span className={`badge-status badge-status--${x.status === "new" ? "partially_paid" : x.status === "closed" ? "cancelled" : "paid"}`}>{t(`ui.support.msgStatuses.${x.status}`)}</span>
              </header>
              <p className="msg-card__contact">
                {x.phone && <a href={`tel:${x.phone.replace(/[^\d+]/g, "")}`}><Icon name="phone" /> {x.phone}</a>}
                {x.email && <a href={`mailto:${x.email}`}><Icon name="mail" /> {x.email}</a>}
              </p>
              <p className="msg-card__body">{x.message}</p>
              {can("support") && (
                <footer>
                  <input className="input input--sm" value={note[x.id] ?? x.replyNote} onChange={(e) => setNote({ ...note, [x.id]: e.target.value })} placeholder={t("ui.support.notePh")} />
                  {x.status === "new" && <button type="button" className="btn btn--outline btn--sm" onClick={() => set(x, "read")}>{t("ui.support.markRead")}</button>}
                  {x.status !== "closed" && <button type="button" className="btn btn--primary btn--sm" onClick={() => set(x, "closed")}>{t("ui.support.done")}</button>}
                  {x.handledBy && <small className="muted">{fill(t("ui.support.handledBy"), { name: x.handledBy })}</small>}
                </footer>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
