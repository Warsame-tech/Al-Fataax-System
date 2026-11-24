import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Icon from "../components/Icon.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import { apiRequest } from "../services/api.js";
import { useApi, useSubmit, Field, FormError, Loading, EmptyState, StatusBadge, SearchBox, Modal, useErrorText, ActionMenu } from "../app/ui.jsx";
import { date, fill } from "../app/format.js";

/*
 * Super admin — architecture update (routes/adminTenancy.js):
 *   RegisterBusiness   /admin/businesses/create        five steps, then the setup page
 *   Provisioning       /admin/businesses/:id/setup     the setup job's steps, live; retry when it failed
 *   Hosting            /admin/hosting                  subdomains, /b/ links, custom domains (DNS check)
 *   Databases          /admin/databases                the database registry: sizes, schema versions, test, migrate
 *   Backups            /admin/backups                  make / download / delete backups
 *   BranchOverview     /admin/branches                 every business's branches and its branch limit
 */

const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "");
const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const absLink = (link) => `${window.location.origin}${link}`;

function Copy({ text }) {
  const { t } = useLanguage();
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* not allowed */ } };
  return <button type="button" className="link-btn" onClick={copy}><Icon name={done ? "check" : "copy"} /> {t(done ? "ui.tenancy.detail.copied" : "ui.tenancy.detail.copy")}</button>;
}

/* A logo box: choose an image (PNG, JPG or WEBP, up to 2 MB), see it, or take it away */
export function LogoPicker({ file, current, onChange, onRemove, error }) {
  const { t } = useLanguage();
  const [preview, setPreview] = useState(null);
  const [bad, setBad] = useState(null);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setBad("invalidLogo"); return; }
    if (f.size > 2 * 1024 * 1024) { setBad("logoTooLarge"); return; }
    setBad(null);
    onChange(f);
  };
  const shown = preview || current;
  return (
    <div className={"logo-pick" + (error || bad ? " has-error" : "")}>
      <span className="ff__label">{t("ui.tenancy.register.logo")}</span>
      <div className="logo-pick__row">
        <label className="logo-pick__box">
          {shown ? <img src={shown} alt="" /> : <span className="logo-pick__empty"><Icon name="image" /><small>{t("ui.tenancy.register.logoAdd")}</small></span>}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} />
        </label>
        <div className="logo-pick__side">
          <label className="btn btn--outline btn--sm logo-pick__btn"><Icon name="upload" /><span>{t(shown ? "ui.tenancy.register.logoChange" : "ui.tenancy.register.logoChoose")}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick} /></label>
          {shown && <button type="button" className="link-btn" onClick={() => { setBad(null); onRemove(); }}>{t("ui.tenancy.register.logoRemove")}</button>}
          <small className="muted">{t("ui.tenancy.register.logoHelp")}</small>
          {(bad || error) && <small className="ff__error">{t(`ui.errors.${bad || error}`)}</small>}
        </div>
      </div>
    </div>
  );
}

/* ===================== register a business ===================== */
const STEPS = ["business", "owner", "plan", "database", "review"];
const STEP_FIELDS = { business: ["name", "slug", "type", "phone", "email", "address"], owner: ["ownerName", "username", "ownerEmail", "ownerPhone", "password"],
  plan: ["planId", "trialDays", "branchName", "maxBranches"], database: ["dbMode"] };

export function RegisterBusiness() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const setup = useApi("/api/admin/setup");
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", slug: "", type: "", phone: "", email: "", address: "", ownerName: "", username: "", ownerEmail: "", ownerPhone: "", password: "",
    planId: "", cycle: "monthly", trialDays: "", branchName: "", maxBranches: "", dbMode: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [slugState, setSlugState] = useState(null);
  const sub = useSubmit();
  const s = setup.data;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => { if (!slugTouched) setF((x) => ({ ...x, slug: slugify(x.name) })); }, [f.name, slugTouched]);
  useEffect(() => {
    if (!f.slug) { setSlugState(null); return undefined; }
    setSlugState({ checking: true });
    const timer = setTimeout(() => apiRequest(`/api/admin/slug-check?slug=${encodeURIComponent(f.slug)}&name=${encodeURIComponent(f.name)}`).then(setSlugState).catch(() => setSlugState(null)), 350);
    return () => clearTimeout(timer);
  }, [f.slug, f.name]);
  useEffect(() => { if (s && !f.dbMode) setF((x) => ({ ...x, dbMode: s.dbMode, trialDays: String(s.trialDays ?? "") })); }, [s, f.dbMode]);

  // field errors from the server send you back to the step that has them
  useEffect(() => {
    const keys = Object.keys(sub.fieldErrors || {});
    if (!keys.length) return;
    const i = STEPS.findIndex((st) => (STEP_FIELDS[st] || []).some((k) => keys.includes(k)));
    if (i >= 0) setStep(i);
  }, [sub.fieldErrors]);

  if (!s) return <Loading />;
  const fe = sub.fieldErrors;
  const plan = s.plans.find((p) => String(p.id) === String(f.planId));
  const typeName = (code) => s.types.find((x) => x.code === code)?.name || code;
  const dbName = `faatix_${(f.slug || "slug").replace(/-/g, "_")}_db`;
  const canNext = [
    f.name.trim().length >= 2 && f.slug && slugState?.ok && f.type && f.phone.trim(),
    f.ownerName.trim().length >= 2 && /^[a-zA-Z0-9_.]{3,30}$/.test(f.username) && (!f.password || f.password.length >= 8),
    true, true, true][step];

  const create = async () => {
    const body = { ...f, planId: f.planId || null, maxBranches: f.maxBranches === "" ? null : Number(f.maxBranches), trialDays: f.trialDays === "" ? null : Number(f.trialDays) };
    const r = await sub.run(() => apiRequest("/api/admin/businesses", { method: "POST", body }));
    if (r && logoFile) {   // the logo goes up right after the business exists (its sign-in page shows it)
      const fd = new FormData();
      fd.append("logo", logoFile);
      await apiRequest(`/api/admin/businesses/${r.businessId}/logo`, { method: "POST", body: fd }).catch(() => {});
    }
    if (r) navigate(`/admin/businesses/${r.businessId}/setup`, { state: { owner: r.owner } });
  };

  return (
    <div className="page reg-wizard">
      <Link className="auth__back" to="/admin/businesses"><Icon name="arrow-left" /><span>{t("ui.common.back")}</span></Link>
      <h1 className="admin-title">{t("ui.tenancy.register.title")}</h1>
      <p className="page-help"><Icon name="info" /> {t("ui.tenancy.register.sub")}</p>
      <ol className="reg-steps">
        {STEPS.map((st, i) => (
          <li key={st} className={i === step ? "is-current" : i < step ? "is-done" : ""}>
            <button type="button" disabled={i > step} onClick={() => setStep(i)}><span>{i < step ? <Icon name="check" /> : i + 1}</span>{t(`ui.tenancy.register.steps.${st}`)}</button>
          </li>
        ))}
      </ol>

      <section className="panel-card">
        {STEPS[step] === "business" && (
          <div className="form-grid form-grid--2">
            <Field label={t("ui.tenancy.register.name")} error={fe.name}><input className="input" value={f.name} onChange={set("name")} maxLength={150} autoFocus /></Field>
            <Field label={t("ui.tenancy.register.slug")} error={fe.slug} hint={t("ui.tenancy.register.slugHelp")}>
              <div className="slug-input">
                <input className="input" value={f.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }); }} maxLength={40} />
                {s.baseDomain && <span className="slug-input__suffix">.{s.baseDomain}</span>}
              </div>
            </Field>
            <div className="ff--full slug-state">
              {slugState?.checking ? <span className="muted">{t("ui.tenancy.register.checking")}</span>
                : slugState?.ok ? <span className="slug-ok"><Icon name="check" /> {t("ui.tenancy.register.slugOk")} · {slugState.url ? fill(t("ui.tenancy.register.slugUrl"), { url: slugState.url }) : fill(t("ui.tenancy.register.slugLink"), { link: absLink(slugState.link) })}</span>
                : slugState?.reason ? <span className="slug-bad"><Icon name="alert" /> {t(`ui.errors.${slugState.reason}`)} {slugState.suggestion && <button type="button" className="link-btn" onClick={() => { setSlugTouched(true); setF({ ...f, slug: slugState.suggestion }); }}>→ {slugState.suggestion}</button>}</span> : null}
            </div>
            <Field label={t("ui.tenancy.register.type")} error={fe.type}>
              <select className="input" value={f.type} onChange={set("type")}><option value="">—</option>{s.types.filter((x) => x.active).map((x) => <option key={x.code} value={x.code}>{t(`register.types.${x.code}`).startsWith("register.") ? x.name : t(`register.types.${x.code}`)}</option>)}</select>
            </Field>
            <Field label={t("ui.tenancy.register.phone")} error={fe.phone}><input className="input" type="tel" value={f.phone} onChange={set("phone")} maxLength={30} /></Field>
            <Field label={t("ui.tenancy.register.email")} error={fe.email}><input className="input" type="email" value={f.email} onChange={set("email")} maxLength={190} /></Field>
            <Field label={t("ui.tenancy.register.address")}><input className="input" value={f.address} onChange={set("address")} maxLength={255} /></Field>
            <div className="ff--full"><LogoPicker file={logoFile} onChange={setLogoFile} onRemove={() => setLogoFile(null)} /></div>
          </div>
        )}

        {STEPS[step] === "owner" && (
          <div className="form-grid form-grid--2">
            <Field label={t("ui.tenancy.register.ownerName")} error={fe.ownerName}><input className="input" value={f.ownerName} onChange={set("ownerName")} maxLength={150} autoFocus /></Field>
            <Field label={t("ui.tenancy.register.username")} error={fe.username}><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase().replace(/\s/g, "") })} autoCapitalize="none" maxLength={30} /></Field>
            <Field label={t("ui.tenancy.register.ownerPhone")}><input className="input" type="tel" value={f.ownerPhone} onChange={set("ownerPhone")} placeholder={f.phone} maxLength={30} /></Field>
            <Field label={t("ui.tenancy.register.ownerEmail")} error={fe.ownerEmail}><input className="input" type="email" value={f.ownerEmail} onChange={set("ownerEmail")} maxLength={190} /></Field>
            <Field label={t("ui.tenancy.register.password")} error={fe.password} hint={t("ui.tenancy.register.passwordHelp")} full>
              <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={set("password")} maxLength={200} />
            </Field>
          </div>
        )}

        {STEPS[step] === "plan" && (
          <div className="form-grid form-grid--2">
            <Field label={t("ui.tenancy.register.plan")} error={fe.planId}>
              <select className="input" value={f.planId} onChange={set("planId")}>
                <option value="">{t("ui.tenancy.register.noPlan")}</option>
                {s.plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.monthly}/{t("ui.billing.cycles.monthly")}</option>)}
              </select>
            </Field>
            {f.planId ? (
              <Field label={t("ui.tenancy.register.cycle")}><div className="seg">{["monthly", "yearly"].map((c) => <button key={c} type="button" aria-pressed={f.cycle === c} onClick={() => setF({ ...f, cycle: c })}>{t(`ui.billing.cycles.${c}`)}</button>)}</div></Field>
            ) : <span />}
            <Field label={t("ui.tenancy.register.trialDays")} error={fe.trialDays}><input className="input" type="number" min="0" max="365" value={f.trialDays} onChange={set("trialDays")} /></Field>
            <Field label={t("ui.tenancy.register.branchName")}><input className="input" value={f.branchName} onChange={set("branchName")} placeholder={t("ui.tenancy.register.branchNamePh")} maxLength={100} /></Field>
            <Field label={t("ui.tenancy.register.maxBranches")} error={fe.maxBranches} hint={plan?.maxBranches ? `${t("ui.tenancy.register.maxBranchesHelp")} (${plan.name}: ${plan.maxBranches})` : t("ui.tenancy.register.maxBranchesHelp")}>
              <input className="input" type="number" min="1" max="500" value={f.maxBranches} onChange={set("maxBranches")} />
            </Field>
          </div>
        )}

        {STEPS[step] === "database" && (
          <div className="db-choice">
            {!s.keySet && s.production && <p className="form-status form-status--error"><Icon name="alert" /> {t("ui.tenancy.register.keyMissing")}</p>}
            {[["dedicated", "database"], ["shared", "server"]].map(([mode, icon]) => (
              <label key={mode} className={"db-choice__opt" + (f.dbMode === mode ? " is-on" : "")}>
                <input type="radio" name="dbMode" value={mode} checked={f.dbMode === mode} onChange={set("dbMode")} />
                <span className="db-choice__icon"><Icon name={icon} /></span>
                <span><strong>{t(`ui.tenancy.register.${mode}`)}</strong><small>{fill(t(`ui.tenancy.register.${mode}Help`), { db: dbName })}</small></span>
              </label>
            ))}
          </div>
        )}

        {STEPS[step] === "review" && (
          <div className="reg-review">
            <p className="muted">{t("ui.tenancy.register.reviewHelp")}</p>
            <dl className="sub-card__facts">
              <div><dt>{t("ui.tenancy.register.name")}</dt><dd className="reg-review__name">{logoFile && <LogoThumb file={logoFile} />}<span><b>{f.name}</b> · {typeName(f.type)}</span></dd></div>
              <div><dt>{t("ui.tenancy.register.slug")}</dt><dd>{slugState?.url || absLink(`/b/${f.slug}`)}</dd></div>
              <div><dt>{t("ui.tenancy.register.phone")}</dt><dd>{f.phone}{f.email ? ` · ${f.email}` : ""}</dd></div>
              <div><dt>{t("ui.tenancy.register.ownerName")}</dt><dd>{f.ownerName} · <code>{f.username}</code></dd></div>
              <div><dt>{t("ui.tenancy.register.plan")}</dt><dd>{plan ? `${plan.name} · ${t(`ui.billing.cycles.${f.cycle}`)}` : t("ui.tenancy.register.noPlan")} · {t("ui.tenancy.register.trialDays")}: {f.trialDays || 0}</dd></div>
              <div><dt>{t("ui.tenancy.register.branchName")}</dt><dd>{f.branchName || t("ui.tenancy.register.branchNamePh")}{f.maxBranches ? ` · ${t("ui.tenancy.branches.limit")} ${f.maxBranches}` : ""}</dd></div>
              <div><dt>{t("ui.tenancy.register.dbMode")}</dt><dd>{f.dbMode === "dedicated" ? <>{t("ui.tenancy.register.dedicated")} · <code>{dbName}</code></> : t("ui.tenancy.register.shared")}</dd></div>
            </dl>
          </div>
        )}

        <FormError error={sub.formError} />
        <div className="form-actions">
          {step > 0 && <button type="button" className="btn btn--outline" onClick={() => setStep(step - 1)}><Icon name="arrow-left" /><span>{t("ui.tenancy.register.back")}</span></button>}
          {step < STEPS.length - 1
            ? <button type="button" className="btn btn--primary" disabled={!canNext} onClick={() => setStep(step + 1)}><span>{t("ui.tenancy.register.next")}</span><Icon name="arrow-right" /></button>
            : <button type="button" className="btn btn--primary" disabled={sub.busy} onClick={create}><Icon name="play" /><span>{t(sub.busy ? "ui.tenancy.register.creating" : "ui.tenancy.register.create")}</span></button>}
        </div>
      </section>
    </div>
  );
}

function LogoThumb({ file }) {
  const [url, setUrl] = useState(null);
  useEffect(() => { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }, [file]);
  return url ? <img className="reg-review__logo" src={url} alt="" /> : null;
}

/* ===================== the setup job, live ===================== */
export function Provisioning({ can, ownerFromState }) {
  const { id } = useParams();
  const { t, lang } = useLanguage();
  const d = useApi(`/api/admin/businesses/${id}/provisioning`);
  const [owner] = useState(ownerFromState || null);
  const sub = useSubmit();
  const job = d.data?.job;
  const busy = job && ["pending", "running"].includes(job.status);
  const reload = d.reload;
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => reload(), 1200);
    return () => clearInterval(timer);
  }, [busy, reload]);
  if (!d.data) return <Loading />;
  const { business: b, database } = d.data;
  const isMove = job?.steps?.some((s) => s.key === "copy");
  const steps = job?.steps?.length ? job.steps : (database?.mode === "shared" ? ["data", "activate"] : ["database", "user", "schema", "data", "activate"]).map((key) => ({ key, status: "waiting" }));
  const retry = async () => { if (await sub.run(() => apiRequest(`/api/admin/businesses/${b.id}/provisioning/retry`, { method: "POST" }))) setTimeout(() => d.reload(), 300); };
  const signin = b.url || absLink(b.link);
  return (
    <div className="page">
      <Link className="auth__back" to={`/admin/businesses/${b.id}`}><Icon name="arrow-left" /><span>{t("ui.common.back")}</span></Link>
      <h1 className="admin-title">{fill(t(isMove ? "ui.tenancy.prov.moveTitle" : "ui.tenancy.prov.title"), { name: b.name })}</h1>
      <section className="panel-card prov">
        <ol className="prov__steps">
          {steps.map((s) => (
            <li key={s.key} className={`is-${s.status}`}>
              <span className="prov__dot">{s.status === "done" ? <Icon name="check" /> : s.status === "failed" ? <Icon name="x" /> : s.status === "running" ? <span className="prov__spin" /> : null}</span>
              <span className="prov__text"><strong>{t(`ui.tenancy.prov.steps.${s.key}`)}</strong><small>{t(`ui.tenancy.prov.status.${s.status}`)}{s.at && s.status !== "waiting" ? ` · ${date(s.at, lang, true)}` : ""}</small>
                {s.error && <small className="prov__err">{s.error}</small>}</span>
            </li>
          ))}
        </ol>
        {job?.status === "succeeded" && <p className="form-status form-status--success"><Icon name="check" /> {fill(t(isMove ? "ui.tenancy.prov.moved" : "ui.tenancy.prov.succeeded"), { name: b.name })}</p>}
        {job?.status === "failed" && <>
          <p className="form-status form-status--error"><Icon name="alert" /> {fill(t("ui.tenancy.prov.failed"), { error: job.error || "—" })}</p>
          <p className="muted">{t(isMove ? "ui.tenancy.prov.moveUndone" : "ui.tenancy.prov.stillInactive")} {job.attempts > 0 && `· ${fill(t("ui.tenancy.prov.attempts"), { n: job.attempts })}`}</p>
        </>}
        <FormError error={sub.formError} />
        <dl className="sub-card__facts">
          <div><dt>{t("ui.tenancy.prov.signinAt")}</dt><dd><a href={signin} target="_blank" rel="noreferrer">{signin}</a> <Copy text={signin} /></dd></div>
          <div><dt>{t("ui.tenancy.detail.database")}</dt><dd>{database?.mode === "dedicated" ? <>{t("ui.tenancy.detail.dedicated")} · <code>{database.database}</code></> : t("ui.tenancy.detail.shared")}</dd></div>
          <div><dt>{t("ui.common.status")}</dt><dd><StatusBadge status={b.status} /></dd></div>
        </dl>
        {owner?.password && (
          <div className="shown-once">
            <p><b>{t("ui.tenancy.prov.ownerLogin")}</b></p>
            <p><code>{owner.username}</code> · <code>{owner.password}</code> <Copy text={`${signin}\n${owner.username}\n${owner.password}`} /></p>
          </div>
        )}
        <div className="form-actions">
          {job?.status === "failed" && can("provision") && <button type="button" className="btn btn--primary" onClick={retry} disabled={sub.busy}><Icon name="refresh" /><span>{t("ui.tenancy.prov.retry")}</span></button>}
          <Link className="btn btn--outline" to={`/admin/businesses/${b.id}`}>{t("ui.tenancy.prov.openBusiness")}</Link>
          {can("provision") && <Link className="btn btn--outline" to="/admin/businesses/create"><Icon name="plus" /><span>{t("ui.tenancy.prov.another")}</span></Link>}
        </div>
      </section>
    </div>
  );
}

/* ===================== hosting & domains ===================== */
export function Hosting({ can }) {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/hosting");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(null);   // { kind: "domain" | "slug", business }
  const [info, setInfo] = useState(null);
  const errText = useErrorText();
  if (!d.data) return <Loading />;
  const { baseDomain } = d.data;
  const rows = d.data.businesses.filter((b) => !q || `${b.name} ${b.slug}`.toLowerCase().includes(q.toLowerCase()));
  const verify = async (x) => { const r = await apiRequest(`/api/admin/domains/${x.id}/verify`, { method: "POST" }).catch((e) => ({ note: errText(e) })); setInfo({ id: x.id, text: r.note, ok: r.verified }); d.reload(); };
  const primary = async (x) => { await apiRequest(`/api/admin/domains/${x.id}`, { method: "PATCH" }); d.reload(); };
  const remove = async (x) => { if (!window.confirm(fill(t("ui.tenancy.hosting.removeConfirm"), { domain: x.domain }))) return; await apiRequest(`/api/admin/domains/${x.id}`, { method: "DELETE" }); d.reload(); };
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.tenancy.hosting.title")}</h1>
      <p className="page-help"><Icon name="info" /> {t("ui.tenancy.hosting.sub")}</p>
      <section className="panel-card">
        <h2 className="panel-card__title"><Icon name="globe" /> {t("ui.tenancy.hosting.baseDomain")}: {baseDomain ? <code>{baseDomain}</code> : "—"}</h2>
        <p className="muted">{baseDomain ? fill(t("ui.tenancy.hosting.dnsHelp"), { domain: baseDomain }) : t("ui.tenancy.hosting.noBase")}</p>
      </section>
      <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder={t("ui.tenancy.hosting.search")} /></div>
      {rows.length === 0 ? <EmptyState text={t("ui.common.noResults")} /> : (
        <div className="host-list">
          {rows.map((b) => (
            <section key={b.id} className="panel-card host-card">
              <header className="host-card__head">
                <Link to={`/admin/businesses/${b.id}`}><strong>{b.name}</strong></Link>
                <StatusBadge status={b.status} />
              </header>
              <dl className="sub-card__facts">
                <div><dt>{t("ui.tenancy.hosting.subdomain")}</dt><dd>{b.url ? <a href={b.url} target="_blank" rel="noreferrer">{b.url.replace("https://", "")}</a> : <code>{b.slug}</code>}</dd></div>
                <div><dt>{t("ui.tenancy.hosting.link")}</dt><dd><a href={absLink(b.link)} target="_blank" rel="noreferrer">{absLink(b.link)}</a> <Copy text={absLink(b.link)} /></dd></div>
              </dl>
              {b.domains.length > 0 && (
                <ul className="domain-list">
                  {b.domains.map((x) => (
                    <li key={x.id}>
                      <span className={`domain-dot is-${x.status}`} />
                      <span className="domain-list__main"><b>{x.domain}</b>{x.primary && <small className="chip-mini">{t("ui.tenancy.hosting.primary")}</small>}
                        <small>{t(`ui.tenancy.hosting.${x.status === "verified" ? "verified" : "pending"}`)}{x.checkedAt ? ` · ${date(x.checkedAt, lang, true)}` : ""}</small>
                        {x.status !== "verified" && <small className="muted">{fill(t("ui.tenancy.hosting.txtHelp"), { name: `_faatix-verify.${x.domain}`, value: x.token })}</small>}
                        {info?.id === x.id && <small className={info.ok ? "slug-ok" : "slug-bad"}>{info.text}</small>}</span>
                      {can("hosting") && <span className="domain-list__act">
                        {x.status !== "verified" && <button type="button" className="btn btn--outline btn--sm" onClick={() => verify(x)}>{t("ui.tenancy.hosting.verify")}</button>}
                        {x.status === "verified" && !x.primary && <button type="button" className="link-btn" onClick={() => primary(x)}>{t("ui.tenancy.hosting.makePrimary")}</button>}
                        <button type="button" className="link-btn" onClick={() => remove(x)}>{t("ui.tenancy.hosting.remove")}</button>
                      </span>}
                    </li>
                  ))}
                </ul>
              )}
              {can("hosting") && <div className="form-actions">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal({ kind: "domain", business: b })}><Icon name="plus" /><span>{t("ui.tenancy.hosting.addDomain")}</span></button>
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setModal({ kind: "slug", business: b })}><Icon name="link" /><span>{t("ui.tenancy.hosting.changeSlug")}</span></button>
              </div>}
            </section>
          ))}
        </div>
      )}
      {modal && <HostingModal modal={modal} baseDomain={baseDomain} onClose={() => setModal(null)} onDone={() => { setModal(null); d.reload(); }} />}
    </div>
  );
}

function HostingModal({ modal, baseDomain, onClose, onDone }) {
  const { t } = useLanguage();
  const isSlug = modal.kind === "slug";
  const [v, setV] = useState(isSlug ? modal.business.slug : "");
  const sub = useSubmit();
  const save = async (e) => {
    e.preventDefault();
    const ok = await sub.run(() => (isSlug
      ? apiRequest(`/api/admin/businesses/${modal.business.id}/slug`, { method: "PATCH", body: { slug: v } })
      : apiRequest(`/api/admin/businesses/${modal.business.id}/domains`, { method: "POST", body: { domain: v } })));
    if (ok) onDone();
  };
  return (
    <Modal title={`${t(isSlug ? "ui.tenancy.hosting.changeSlug" : "ui.tenancy.hosting.addDomain")} · ${modal.business.name}`} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t(isSlug ? "ui.tenancy.hosting.subdomain" : "ui.tenancy.hosting.customDomains")} error={isSlug ? sub.fieldErrors.slug : sub.fieldErrors.domain}>
          <div className="slug-input">
            <input className="input" value={v} onChange={(e) => setV(isSlug ? e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") : e.target.value.trim())} placeholder={isSlug ? "" : t("ui.tenancy.hosting.domainPh")} autoFocus />
            {isSlug && baseDomain && <span className="slug-input__suffix">.{baseDomain}</span>}
          </div>
        </Field>
        <FormError error={sub.formError?.errors ? null : sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy || !v}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* ===================== databases ===================== */
export function Databases() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const d = useApi("/api/admin/databases");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [result, setResult] = useState({});   // businessId → { ok, text }
  const [allMsg, setAllMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const errText = useErrorText();
  if (!d.data) return <Loading />;
  const { core, databases, schemaVersion } = d.data;
  const rows = databases.filter((x) => (filter === "all" || x.mode === filter) && (!q || `${x.name} ${x.slug} ${x.database || ""}`.toLowerCase().includes(q.toLowerCase())));
  const test = async (x) => {
    setBusy(`t${x.businessId}`);
    const r = await apiRequest(`/api/admin/databases/${x.businessId}/test`, { method: "POST" }).catch((e) => ({ ok: false, error: e.code }));
    setResult({ ...result, [x.businessId]: { ok: r.ok, text: r.ok ? fill(t("ui.tenancy.db.testOk"), { ms: r.ms, user: r.user, v: r.schemaVersion, users: r.users }) : fill(t("ui.tenancy.db.testFail"), { error: r.error }) } });
    setBusy(null);
  };
  const migrate = async (x) => {
    setBusy(`m${x.businessId}`);
    const r = await apiRequest(`/api/admin/databases/${x.businessId}/migrate`, { method: "POST" }).then((o) => ({ ok: true, text: fill(t("ui.tenancy.db.migrated"), { v: o.version }) })).catch((e) => ({ ok: false, text: errText(e) }));
    setResult({ ...result, [x.businessId]: r });
    setBusy(null); d.reload();
  };
  // a shared business → its own database (the setup page then shows the move, step by step)
  const move = async (x) => {
    if (!window.confirm(fill(t("ui.tenancy.db.moveConfirm"), { name: x.name }))) return;
    setBusy(`v${x.businessId}`);
    try { await apiRequest(`/api/admin/databases/${x.businessId}/move`, { method: "POST" }); navigate(`/admin/businesses/${x.businessId}/setup`); }
    catch (e) { setResult({ ...result, [x.businessId]: { ok: false, text: errText(e) } }); setBusy(null); }
  };
  const migrateAll = async () => {
    setBusy("all");
    const r = await apiRequest("/api/admin/databases/migrate-all", { method: "POST" }).catch(() => ({ results: [] }));
    setAllMsg(fill(t("ui.tenancy.db.migratedAll"), { n: r.results.length, f: r.results.filter((x) => x.ok === false).length }));
    setBusy(null); d.reload();
  };
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.tenancy.db.title")}</h1>
      <p className="page-help"><Icon name="info" /> {t("ui.tenancy.db.sub")}</p>
      <div className="db-hero">
        <section className="panel-card db-hero__core">
          <span className="db-hero__icon"><Icon name="server" /></span>
          <div>
            <h2>{t("ui.tenancy.db.central")} <code>{core.database}</code></h2>
            <p className="muted">{fill(t("ui.tenancy.db.sharedCount"), { n: core.shared })} · {core.mb ?? "—"} MB · {core.tables ?? "—"} {t("ui.tenancy.db.tables").toLowerCase()}</p>
            <p className="muted">{t("ui.tenancy.db.lastBackup")}: {core.lastBackupAt ? date(core.lastBackupAt, lang, true) : t("ui.tenancy.db.never")}</p>
          </div>
          <span className={`db-ver ${core.schemaVersion >= schemaVersion ? "is-ok" : "is-behind"}`}>{core.schemaVersion >= schemaVersion ? t("ui.tenancy.db.upToDate") : t("ui.tenancy.db.behind")}</span>
        </section>
        <section className="panel-card db-hero__stats">
          <p className="muted">{fill(t("ui.tenancy.db.current"), { v: schemaVersion })}</p>
          <div className="db-hero__nums">
            <div><b>{databases.filter((x) => x.mode === "dedicated").length}</b><small>{t("ui.tenancy.db.own")}</small></div>
            <div><b>{databases.filter((x) => x.mode === "dedicated" && !x.upToDate).length}</b><small>{t("ui.tenancy.db.behind")}</small></div>
            <div><b>{databases.filter((x) => x.status === "failed").length}</b><small>{t("ui.tenancy.prov.status.failed")}</small></div>
          </div>
          <button type="button" className="btn btn--primary btn--sm" onClick={migrateAll} disabled={busy === "all"}><Icon name="refresh" /><span>{t("ui.tenancy.db.migrateAll")}</span></button>
          {allMsg && <small className="muted">{allMsg}</small>}
        </section>
      </div>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} />
        <div className="seg">{["all", "dedicated", "shared"].map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{t(`ui.tenancy.db.filter${k === "all" ? "All" : k === "dedicated" ? "Own" : "Shared"}`)}</button>)}</div>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>{t("ui.tenancy.db.business")}</th><th>{t("ui.tenancy.db.database")}</th><th>{t("ui.tenancy.db.status")}</th><th>{t("ui.tenancy.db.size")}</th><th>{t("ui.tenancy.db.lastMigrated")}</th><th>{t("ui.tenancy.db.lastBackup")}</th><th /></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.businessId}>
              <td><Link to={`/admin/businesses/${x.businessId}`}><b>{x.name}</b></Link><small className="cell-sub">{x.slug}</small></td>
              <td>{x.mode === "dedicated" ? <><code>{x.database}</code><small className="cell-sub">{x.user || "—"}</small></> : <span className="muted">{t("ui.tenancy.db.sharedMode")}</span>}</td>
              <td><span className={`db-ver ${x.status === "ready" ? (x.upToDate ? "is-ok" : "is-behind") : x.status === "failed" ? "is-bad" : "is-wait"}`}>{x.status === "ready" ? (x.upToDate ? t("ui.tenancy.db.upToDate") : t("ui.tenancy.db.behind")) : t(`ui.tenancy.prov.status.${x.status === "failed" ? "failed" : "running"}`)}</span>
                <small className="cell-sub">v{x.schemaVersion || "—"}</small>
                {x.lastError && <small className="cell-sub prov__err" title={x.lastError}>{t("ui.tenancy.db.error")}: {x.lastError.slice(0, 60)}</small>}</td>
              <td>{x.size ? `${x.size.mb} MB · ${x.size.tables}` : "—"}</td>
              <td>{x.lastMigratedAt ? date(x.lastMigratedAt, lang, true) : "—"}</td>
              <td>{x.lastBackupAt ? date(x.lastBackupAt, lang, true) : t("ui.tenancy.db.never")}</td>
              <td className="row-actions">
                {x.mode === "shared" && x.status === "ready" && !["pending", "provisioning"].includes(x.businessStatus) && <button type="button" className="btn btn--primary btn--sm" onClick={() => move(x)} disabled={busy === `v${x.businessId}`}><Icon name="database" /><span>{t("ui.tenancy.db.move")}</span></button>}
                <ActionMenu title={x.name} items={[
                  x.status === "ready" && { label: t("ui.tenancy.db.test"), icon: "activity", onClick: () => test(x), disabled: busy === `t${x.businessId}` },
                  x.mode === "dedicated" && x.status === "ready" && { label: t("ui.tenancy.db.migrate"), icon: "refresh", onClick: () => migrate(x), disabled: busy === `m${x.businessId}` }
                ]} />
                {result[x.businessId] && <small className={result[x.businessId].ok ? "slug-ok" : "slug-bad"}>{result[x.businessId].text}</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

/* ===================== backups ===================== */
export function Backups() {
  const { t, lang } = useLanguage();
  const d = useApi("/api/admin/backups");
  const list = useApi("/api/admin/businesses");
  const [scope, setScope] = useState("core");
  const [bid, setBid] = useState("");
  const sub = useSubmit();
  if (!d.data) return <Loading />;
  const make = async () => { if (await sub.run(() => apiRequest("/api/admin/backups", { method: "POST", body: { scope, businessId: scope === "business" ? Number(bid) : null } }))) d.reload(); };
  const del = async (k) => { if (!window.confirm(fill(t("ui.tenancy.backups.deleteConfirm"), { file: k.file }))) return; await apiRequest(`/api/admin/backups/${k.id}`, { method: "DELETE" }); d.reload(); };
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.tenancy.backups.title")}</h1>
      <p className="page-help"><Icon name="info" /> {t("ui.tenancy.backups.sub")}</p>
      <section className="panel-card">
        <h2 className="panel-card__title"><Icon name="hard-drive" /> {t("ui.tenancy.backups.now")}</h2>
        <div className="backup-make">
          <div className="seg">{["core", "business"].map((k) => <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)}>{t(`ui.tenancy.backups.${k}`)}</button>)}</div>
          {scope === "business" && <select className="input input--auto" value={bid} onChange={(e) => setBid(e.target.value)}><option value="">{t("ui.tenancy.backups.choose")}</option>{(list.data?.businesses || []).filter((b) => !["pending", "provisioning"].includes(b.status)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          <button type="button" className="btn btn--primary" disabled={sub.busy || (scope === "business" && !bid)} onClick={make}><Icon name="hard-drive" /><span>{t(sub.busy ? "ui.tenancy.backups.running" : "ui.tenancy.backups.run")}</span></button>
        </div>
        <FormError error={sub.formError} />
        <p className="muted">{d.data.daily ? fill(t("ui.tenancy.backups.dailyOn"), { n: d.data.keep }) : t("ui.tenancy.backups.dailyOff")} · {fill(t("ui.tenancy.backups.folder"), { folder: d.data.folder })}</p>
      </section>
      {d.data.backups.length === 0 ? <EmptyState icon="hard-drive" text={t("ui.tenancy.backups.empty")} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t("ui.tenancy.backups.when")}</th><th>{t("ui.tenancy.backups.what")}</th><th>{t("ui.tenancy.backups.file")}</th><th className="num">{t("ui.tenancy.backups.size")}</th><th className="num">{t("ui.tenancy.backups.rows")}</th><th>{t("ui.tenancy.backups.by")}</th><th /></tr></thead>
          <tbody>
            {d.data.backups.map((k) => (
              <tr key={k.id}>
                <td>{date(k.at, lang, true)}</td>
                <td>{k.scope === "core" ? t("ui.tenancy.backups.core") : k.business || `#${k.businessId}`}{k.status !== "done" && <small className="cell-sub prov__err">{k.status}{k.error ? ` · ${k.error}` : ""}</small>}</td>
                <td><code className="action-code">{k.file}</code>{!k.exists && k.status === "done" && <small className="cell-sub prov__err">{t("ui.tenancy.backups.missing")}</small>}</td>
                <td className="num">{bytes(k.size)}</td><td className="num">{k.rows}</td><td>{k.admin || t("ui.tenancy.backups.auto")}</td>
                <td className="row-actions">
                  {k.exists && <a className="btn btn--outline btn--sm" href={`/api/admin/backups/${k.id}/download`}><Icon name="download" /><span>{t("ui.tenancy.backups.download")}</span></a>}
                  <button type="button" className="link-btn" onClick={() => del(k)}>{t("ui.common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="page-help"><Icon name="shield-check" /> {t("ui.tenancy.backups.restoreNote")}</p>
    </div>
  );
}

/* ===================== branch overview ===================== */
export function BranchOverview({ can }) {
  const { t } = useLanguage();
  const d = useApi("/api/admin/branches-overview");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const rows = useMemo(() => (d.data?.businesses || []).filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase())), [d.data, q]);
  if (!d.data) return <Loading />;
  return (
    <div className="page">
      <h1 className="admin-title">{t("ui.tenancy.branches.title")}</h1>
      <p className="page-help"><Icon name="info" /> {t("ui.tenancy.branches.sub")}</p>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t("ui.tenancy.branches.search")} />
        <span className="muted">{fill(t("ui.tenancy.branches.total"), { n: d.data.totals.branches, b: d.data.totals.businesses })}</span>
      </div>
      {rows.length === 0 ? <EmptyState icon="branch" text={t("ui.common.noResults")} /> : (
        <div className="host-list">
          {rows.map((b) => {
            const active = b.branches?.filter((x) => x.active).length || 0;
            const full = b.limit !== null && active >= b.limit;
            return (
              <section key={b.id} className="panel-card host-card">
                <header className="host-card__head">
                  <Link to={`/admin/businesses/${b.id}`}><strong>{b.name}</strong></Link>
                  <span className={`branch-limit${full ? " is-full" : ""}`}>{active} / {b.limit ?? "∞"} <small>{b.limitFrom ? t(`ui.tenancy.branches.${b.limitFrom === "plan" ? "fromPlan" : "fromBusiness"}`) : t("ui.tenancy.branches.noLimit")}</small></span>
                  {can("businesses") && <button type="button" className="link-btn" onClick={() => setEdit(b)}>{t("ui.tenancy.branches.setLimit")}</button>}
                </header>
                {b.unreachable ? <p className="slug-bad">{t("ui.tenancy.branches.unreachable")}</p> : (
                  <ul className="branch-rows">
                    {b.branches.map((x) => (
                      <li key={x.id} className={x.active ? "" : "is-off"}>
                        <Icon name="branch" />
                        <span className="branch-rows__name"><b>{x.name}</b>{x.main && <small className="chip-mini">{t("ui.tenancy.branches.main")}</small>}{x.code && <small className="muted"> · {x.code}</small>}
                          <small className="muted">{[x.manager && `${t("ui.tenancy.branches.manager")}: ${x.manager}`, x.address].filter(Boolean).join(" · ")}</small></span>
                        <span className="branch-rows__num"><b>{x.users}</b><small>{t("ui.tenancy.branches.users")}</small></span>
                        <span className="branch-rows__num"><b>{x.sales30}</b><small>{t("ui.tenancy.branches.sales30")}</small></span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {edit && <BranchLimit business={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); d.reload(); }} />}
    </div>
  );
}

export function BranchLimit({ business, onClose, onDone }) {
  const { t } = useLanguage();
  const [v, setV] = useState(business.limitFrom === "business" ? String(business.limit) : business.maxBranches ? String(business.maxBranches) : "");
  const sub = useSubmit();
  const save = async (e) => { e.preventDefault(); if (await sub.run(() => apiRequest(`/api/admin/businesses/${business.id}/branch-limit`, { method: "PATCH", body: { maxBranches: v === "" ? null : Number(v) } }))) onDone(); };
  return (
    <Modal title={`${t("ui.tenancy.branches.setLimit")} · ${business.name}`} onClose={onClose}>
      <form onSubmit={save} className="form-grid">
        <Field label={t("ui.tenancy.branches.setLimit")} error={sub.fieldErrors.maxBranches} hint={t("ui.tenancy.branches.limitHelp")}><input className="input" type="number" min="1" max="500" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
        <FormError error={sub.formError?.errors ? null : sub.formError} />
        <div className="form-actions"><button type="button" className="btn btn--outline" onClick={onClose}>{t("ui.common.cancel")}</button><button type="submit" className="btn btn--primary" disabled={sub.busy}>{t("ui.common.save")}</button></div>
      </form>
    </Modal>
  );
}

/* Modules Faatix can switch off for one business (lib/modules.js): off = hidden in its app, and its API refuses changes */
export function BusinessModules({ businessId, can }) {
  const { t } = useLanguage();
  const d = useApi(`/api/admin/businesses/${businessId}/modules`);
  const [off, setOff] = useState(null);
  const sub = useSubmit();
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (d.data) setOff(new Set(d.data.modules.filter((m) => !m.enabled).map((m) => m.id))); }, [d.data]);
  if (!d.data || !off) return null;
  const toggle = (m) => { setSaved(false); const n = new Set(off); if (n.has(m)) n.delete(m); else n.add(m); setOff(n); };
  const save = async () => { if (await sub.run(() => apiRequest(`/api/admin/businesses/${businessId}/modules`, { method: "PUT", body: { disabled: [...off] } }))) setSaved(true); };
  return (
    <section className="panel-card">
      <h2 className="panel-card__title"><Icon name="grid" /> {t("ui.tenancy.modules.title")}</h2>
      <p className="muted">{t("ui.tenancy.modules.help")}</p>
      <div className="type-toggles">
        {d.data.modules.map((m) => (
          <label key={m.id} className={"type-toggle" + (off.has(m.id) ? " is-off" : "")}>
            <input type="checkbox" checked={!off.has(m.id)} disabled={!can("businesses")} onChange={() => toggle(m.id)} /> {t(`app.modules.${m.id}`)}
          </label>
        ))}
      </div>
      <FormError error={sub.formError} />
      {can("businesses") && <div className="form-actions"><button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={sub.busy}>{t("ui.common.save")}</button>{saved && <span className="slug-ok"><Icon name="check" /> {t("ui.common.saved")}</span>}</div>}
    </section>
  );
}

/* the setup page reads the owner's one-time password from the navigation state (never from the address) */
export function ProvisioningRoute({ can }) {
  const { state } = useLocation();
  return <Provisioning can={can} ownerFromState={state?.owner || null} />;
}
