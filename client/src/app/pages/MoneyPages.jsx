import { useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useLanguage } from "../../i18n/LanguageContext.jsx";
import { apiRequest } from "../../services/api.js";
import { PageHeader, Tabs, useApi, usePerm, useSubmit, useMoney, Modal, Field, FormError, Money, EmptyState, Loading, PaymentFields, DateRange, daysAgo, isoDate, downloadCsv } from "../ui.jsx";
import { date } from "../format.js";

const EXPENSE_CATS = ["rent", "salaries", "electricity", "internet", "transport", "repairs", "marketing", "water", "taxes", "other"];
const INCOME_CATS = ["service", "commission", "rental", "interest", "other"];

/* ===================== Expenses & other income ===================== */
export function Expenses() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const [tab, setTab] = useState("expenses");
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const [adding, setAdding] = useState(false);
  const isExp = tab === "expenses";
  const list = useApi(`/api/money/${isExp ? "expenses" : "income"}?${new URLSearchParams(range)}`);
  const catKey = (c) => t(`ui.money.${isExp ? "categories" : "incomeCategories"}.${c}`);
  const del = async (id) => {
    if (!window.confirm(t("ui.money.deleteConfirm"))) return;
    try { await apiRequest(`/api/money/${isExp ? "expenses" : "income"}/${id}`, { method: "DELETE" }); list.reload(); } catch { /* shown on reload */ }
  };
  const rows = list.data?.entries || [];

  return (
    <div className="page">
      <PageHeader icon="wallet" title={t("app.modules.expenses")} actions={
        <>
          <button type="button" className="btn btn--outline" onClick={() => downloadCsv(`${tab}.csv`, ["date", "category", "amount", "method", "description"], rows.map((r) => [r.date, r.category, r.amount, r.method, r.description || ""]))}><Icon name="download" /><span>{t("ui.common.exportCsv")}</span></button>
          {can("expenses.create") && <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}><Icon name="plus" /><span>{t(isExp ? "ui.money.addExpense" : "ui.money.addIncome")}</span></button>}
        </>
      } />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "expenses", label: t("ui.money.expenses"), icon: "arrow-up-right" }, { id: "income", label: t("ui.money.income"), icon: "arrow-down-left" }]} />
      <div className="toolbar"><DateRange value={range} onChange={setRange} /></div>

      {list.loading && !list.data ? <Loading /> : (
        <div className="split-view">
          <section className="panel-card">
            <h2 className="panel-card__title">{t("ui.money.byCategory")}</h2>
            {(list.data?.byCategory || []).length === 0 ? <p className="dash-empty">{t("ui.money.empty")}</p> : (
              <ul className="bars-list">
                {list.data.byCategory.map((c) => (
                  <li key={c.category}>
                    <span>{catKey(c.category)}</span><Money value={c.total} />
                    <span className="bars-list__bar"><i style={{ width: `${Math.max(4, (c.total / (list.data.total || 1)) * 100)}%` }} /></span>
                  </li>
                ))}
              </ul>
            )}
            <p className="panel-card__total">{t("ui.common.total")}: <Money value={list.data?.total || 0} className="strong" /></p>
          </section>
          <section className="panel-card">
            {rows.length === 0 ? <EmptyState icon="wallet" text={t("ui.money.empty")} /> : (
              <div className="table-wrap"><table className="table table--compact">
                <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.common.category")}</th><th>{t("ui.common.description")}</th><th>{t("ui.common.method")}</th><th className="num">{t("ui.common.amount")}</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{date(r.date, lang)}</td><td>{catKey(r.category)}</td><td>{r.description || "—"}</td><td>{t(`ui.methods.${r.method}`)}</td>
                      <td className="num"><Money value={r.amount} /></td>
                      <td>{can("expenses.delete") && <button type="button" className="icon-btn" aria-label={t("ui.common.delete")} onClick={() => del(r.id)}><Icon name="trash" /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
        </div>
      )}
      {adding && <EntryForm kind={isExp ? "expenses" : "income"} cats={isExp ? EXPENSE_CATS : INCOME_CATS} catKey={catKey} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); list.reload(); }} />}
    </div>
  );
}

function EntryForm({ kind, cats, catKey, onClose, onSaved }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ category: "", amount: "", date: isoDate(new Date()), method: "cash", bankAccountId: "", description: "" });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    if (await sub.run(() => apiRequest(`/api/money/${kind}`, { method: "POST", body: f }))) onSaved();
  };
  return (
    <Modal title={t(kind === "expenses" ? "ui.money.addExpense" : "ui.money.addIncome")} onClose={onClose}>
      <form onSubmit={save} className="form-grid form-grid--2">
        <Field label={t("ui.common.category")} error={sub.fieldErrors.category}>
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">{t("ui.common.choose")}</option>
            {cats.map((c) => <option key={c} value={c}>{catKey(c)}</option>)}
          </select>
        </Field>
        <Field label={t("ui.common.amount")} error={sub.fieldErrors.amount}><input className="input" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t("ui.common.date")} error={sub.fieldErrors.date}><input className="input" type="date" max={isoDate(new Date())} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={`${t("ui.common.description")} ${t("ui.common.optional")}`}><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="ff--full"><PaymentFields method={f.method} onMethod={(v) => setF({ ...f, method: v })} bankId={f.bankAccountId} onBank={(v) => setF({ ...f, bankAccountId: v })} errors={sub.fieldErrors} /></div>
        <FormError error={sub.formError} />
        <div className="form-actions ff--full">
          <button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ===================== Cash & bank ===================== */
export function Cashbook() {
  const { t, lang } = useLanguage();
  const can = usePerm();
  const accounts = useApi("/api/accounts");
  const [range, setRange] = useState({ from: daysAgo(29), to: isoDate(new Date()) });
  const [account, setAccount] = useState("");
  const tx = useApi(`/api/accounts/transactions?${new URLSearchParams({ ...range, account })}`);
  const [modal, setModal] = useState(null); // "bank" | "entry" | "transfer"
  const refresh = () => { setModal(null); accounts.reload(); tx.reload(); };
  const all = [
    ...(accounts.data?.cash || []).map((a) => ({ ref: `cash:${a.id}`, name: a.name, balance: a.balance, icon: "wallet" })),
    ...(accounts.data?.bank || []).map((a) => ({ ref: `bank:${a.id}`, name: `${a.bankName} · ${a.accountName}`, balance: a.balance, icon: "landmark", number: a.accountNumber }))
  ];
  const total = all.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="page">
      <PageHeader icon="book-open" title={t("ui.cash.title")} actions={can("cash.edit") && (
        <>
          <button type="button" className="btn btn--outline" onClick={() => setModal("bank")}><Icon name="landmark" /><span>{t("ui.cash.addBank")}</span></button>
          <button type="button" className="btn btn--outline" onClick={() => setModal("transfer")}><Icon name="swap" /><span>{t("ui.cash.transfer")}</span></button>
          <button type="button" className="btn btn--primary" onClick={() => setModal("entry")}><Icon name="plus" /><span>{t("ui.cash.entry")}</span></button>
        </>
      )} />

      {accounts.loading && !accounts.data ? <Loading /> : (
        <div className="acct-grid">
          <article className="acct-card acct-card--total"><small>{t("ui.cash.totalBalance")}</small><Money value={total} /></article>
          {all.map((a) => (
            <button key={a.ref} type="button" className={"acct-card" + (account === a.ref ? " is-active" : "")} onClick={() => setAccount(account === a.ref ? "" : a.ref)}>
              <span className="acct-card__icon"><Icon name={a.icon} /></span>
              <small>{a.name}{a.number ? ` · ${a.number}` : ""}</small>
              <Money value={a.balance} className={a.balance < 0 ? "is-neg" : ""} />
            </button>
          ))}
        </div>
      )}

      <div className="toolbar"><h2 className="panel-card__title">{t("ui.cash.transactions")}</h2><DateRange value={range} onChange={setRange} /></div>
      {tx.loading && !tx.data ? <Loading /> : (tx.data?.transactions || []).length === 0 ? <EmptyState icon="book-open" text={t("ui.cash.empty")} /> : (
        <div className="table-wrap"><table className="table table--compact">
          <thead><tr><th>{t("ui.common.date")}</th><th>{t("ui.cash.account")}</th><th>{t("ui.cash.direction")}</th><th>{t("ui.common.description")}</th><th>{t("ui.common.user")}</th><th className="num">{t("ui.common.amount")}</th></tr></thead>
          <tbody>
            {tx.data.transactions.map((x) => (
              <tr key={x.id}>
                <td>{date(x.at, lang, true)}</td><td>{x.account}</td><td>{t(`ui.cash.types.${x.type}`)}</td><td>{x.description || "—"}</td><td>{x.user || "—"}</td>
                <td className={"num " + (x.direction === "in" ? "is-pos" : "is-neg")}>{x.direction === "in" ? "+" : "−"}<Money value={x.amount} /></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {modal === "bank" && <BankForm onClose={() => setModal(null)} onSaved={refresh} />}
      {(modal === "entry" || modal === "transfer") && <MoveForm mode={modal} accounts={all} onClose={() => setModal(null)} onSaved={refresh} />}
    </div>
  );
}

function BankForm({ onClose, onSaved }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ bankName: "", accountName: "", accountNumber: "" });
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest("/api/accounts/bank", { method: "POST", body: f }))) onSaved(); };
  return (
    <Modal title={t("ui.cash.addBank")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.cash.bankName")} error={sub.fieldErrors.bankName}><input className="input" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
        <Field label={t("ui.cash.accountName")} error={sub.fieldErrors.accountName}><input className="input" value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></Field>
        <Field label={`${t("ui.cash.accountNumber")} ${t("ui.common.optional")}`}><input className="input" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

function MoveForm({ mode, accounts, onClose, onSaved }) {
  const { t } = useLanguage();
  const [f, setF] = useState({ account: accounts[0]?.ref || "", from: accounts[0]?.ref || "", to: accounts[1]?.ref || "", direction: "in", amount: "", description: "" });
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    const body = mode === "entry" ? { account: f.account, direction: f.direction, amount: f.amount, description: f.description } : { from: f.from, to: f.to, amount: f.amount, description: f.description };
    if (await sub.run(() => apiRequest(`/api/accounts/${mode}`, { method: "POST", body }))) onSaved();
  };
  const sel = (k) => (
    <select className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      {accounts.map((a) => <option key={a.ref} value={a.ref}>{a.name}</option>)}
    </select>
  );
  return (
    <Modal title={t(mode === "entry" ? "ui.cash.entry" : "ui.cash.transfer")} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        {mode === "entry" ? (
          <>
            <Field label={t("ui.cash.account")} error={sub.fieldErrors.account}>{sel("account")}</Field>
            <Field label={t("ui.cash.direction")}><div className="seg">{["in", "out"].map((d) => <button key={d} type="button" aria-pressed={f.direction === d} onClick={() => setF({ ...f, direction: d })}>{t(`ui.cash.${d}`)}</button>)}</div></Field>
          </>
        ) : (
          <>
            <Field label={t("ui.cash.fromAcc")} error={sub.fieldErrors.from}>{sel("from")}</Field>
            <Field label={t("ui.cash.toAcc")} error={sub.fieldErrors.to}>{sel("to")}</Field>
          </>
        )}
        <Field label={t("ui.common.amount")} error={sub.fieldErrors.amount}><input className="input" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t("ui.common.description")} error={sub.fieldErrors.description}><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <FormError error={sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

export { useMoney };
