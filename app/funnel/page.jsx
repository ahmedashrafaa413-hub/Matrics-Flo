"use client";

// Full-funnel dashboard: live Snapchat results per campaign, ad set and ad,
// with cost per funnel stage, where each one breaks, and what to do with it.
// Read-only: it never changes anything in the ad accounts.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Ghost, RefreshCw, Filter, ChevronLeft, Globe2, Info } from "lucide-react";
import { apiGet } from "../../lib/api";
import { getSetting, saveSetting } from "../../lib/storage";
import { STAGES, STEPS, analyzeRows, roasBand } from "../../lib/funnelDiagnosis.mjs";
import s from "./funnel.module.css";

const PRESETS = [
  { value: "today", label: "اليوم" },
  { value: "yesterday", label: "أمس" },
  { value: "last_7d", label: "آخر 7 أيام" },
  { value: "last_30d", label: "آخر 30 يوم" },
  { value: "custom", label: "مخصص" }
];
const LEVELS = [
  { value: "campaign", label: "الحملات" },
  { value: "adsquad", label: "المجموعات الإعلانية" },
  { value: "ad", label: "الإعلانات" }
];
const VERDICTS = [
  { key: "scale", label: "زوّد الميزانية", tone: "good" },
  { key: "revive", label: "كسبان ومتوقف", tone: "good" },
  { key: "hold_good", label: "كويس، ثبّت", tone: "good" },
  { key: "keep", label: "استنى", tone: "ok" },
  { key: "fix", label: "صلّح", tone: "ok" },
  { key: "watch", label: "راقب", tone: "ok" },
  { key: "cut", label: "وقّف بدري", tone: "bad" },
  { key: "learning", label: "بيانات قليلة", tone: "neutral" }
];
const STATUS_AR = { ACTIVE: "شغال", PAUSED: "متوقف", DELETED: "محذوف", ARCHIVED: "مؤرشف" };

const fmtInt = (v) => (v === null || v === undefined ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
const fmtMoney = (v, cur = "USD") => {
  if (v === null || v === undefined) return "—";
  const sym = cur === "USD" ? "$" : cur === "SAR" ? "﷼" : `${cur} `;
  const n = Number(v);
  return `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 })}`;
};
const fmtPct = (v, d = 2) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(d)}%`);
const fmtRoas = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}x`);

function riyadhDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function RoasBadge({ roas, target }) {
  const band = roasBand(roas, target);
  return <span className={`${s.badge} ${s[band]}`}>{fmtRoas(roas)}</span>;
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={s.kpi}>
      <div className={s.kpiLabel}>{label}</div>
      <div className={`${s.kpiValue} ${tone ? s[tone] : ""}`}>{value}</div>
      {sub ? <div className={s.kpiSub}>{sub}</div> : null}
    </div>
  );
}

function AccountFunnel({ funnel, currency }) {
  const stages = STAGES.filter((st) => st.key !== "landing_page_views" || funnel.has_landing);
  const top = Math.max(1, funnel.counts.impressions);
  // Bars are log-scaled so purchases stay visible next to impressions.
  const width = (v) => (v > 0 ? Math.max(3, (Math.log10(v + 1) / Math.log10(top + 1)) * 100) : 0);
  return (
    <div className={s.funnel}>
      {stages.map((st, i) => {
        const value = funnel.counts[st.key];
        const step = STEPS.find((st2) => st2.to === st.key);
        const stepText = step ? `↓ ${fmtPct(funnel.steps[step.key])} ${step.from === "impressions" ? "من الظهور (CTR)" : step.from === "swipes" ? "من السوايب" : "من بدء الدفع"}` : null;
        return (
          <Fragment key={st.key}>
            {stepText ? <div className={s.stepRate}>{stepText}</div> : null}
            <div className={s.funnelRow}>
              <div className={s.funnelName}>{st.label}</div>
              <div className={s.barTrack}>
                <div className={`${s.bar} ${i === stages.length - 1 ? s.barLast : ""}`} style={{ width: `${width(value)}%` }}>{fmtInt(value)}</div>
              </div>
              <div className={s.funnelMeta}>
                <span>{st.key === "impressions" ? "CPM" : "التكلفة"}: <b>{fmtMoney(funnel.costs[st.key], currency)}</b></span>
                {st.key === "impressions" && funnel.hook_rate !== null ? <span>Hook rate: <b>{fmtPct(funnel.hook_rate)}</b></span> : null}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function MiniFunnel({ funnel, breakStep }) {
  const keys = ["swipes", "landing_page_views", "add_to_cart", "initiate_checkout", "purchases"];
  const top = Math.max(1, funnel.counts.swipes);
  const weakTo = STEPS.find((st) => st.key === breakStep)?.to;
  return (
    <div className={s.miniFunnel} title="سوايب ← LPV ← سلة ← دفع ← شراء">
      {keys.map((k) => {
        const v = funnel.counts[k];
        const h = v > 0 ? Math.max(8, (Math.log10(v + 1) / Math.log10(top + 1)) * 100) : 4;
        return <div key={k} className={`${s.miniBar} ${k === weakTo ? s.miniBarWeak : ""}`} style={{ height: `${h}%` }} />;
      })}
    </div>
  );
}

function CostCell({ value, avg, currency }) {
  const tone = value === null ? "neutral" : avg ? (value > avg * 2 ? "bad" : value <= avg ? "good" : "ok") : "";
  return (
    <td className={s.costCell}>
      <span className={tone ? s[tone] : ""}>{fmtMoney(value, currency)}</span>
      {avg ? <div className={s.costAvg}>متوسط {fmtMoney(avg, currency)}</div> : null}
    </td>
  );
}

function Detail({ item, benchmark, currency, onDrill, level }) {
  const { funnel, diagnosis } = item;
  return (
    <div className={s.detail}>
      <div>
        <div className={s.cardTitle}>
          التشخيص: <span className={`${s.badge} ${s[diagnosis.tone]}`}>{diagnosis.verdict_label}</span>
        </div>
        <p style={{ margin: "0 0 8px", color: "var(--text)", fontSize: 13 }}>{diagnosis.action}</p>
        {diagnosis.reasons.length ? (
          <ul className={s.detailList}>{diagnosis.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : (
          <p className={s.hint}>مفيش مرحلة أضعف بوضوح من متوسط الحساب.</p>
        )}
        {item.daily_budget !== null || item.bid !== null ? (
          <p className={s.hint} style={{ marginTop: 10 }}>
            ميزانية يومية: {fmtMoney(item.daily_budget, currency)} · البيد: {fmtMoney(item.bid, currency)} {item.goal ? `· الهدف: ${item.goal}` : ""}
          </p>
        ) : null}
        {level !== "ad" ? (
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} style={{ marginTop: 10 }} onClick={() => onDrill(item)}>
            {level === "campaign" ? "اعرض المجموعات الإعلانية" : "اعرض الإعلانات"} <ChevronLeft size={14} />
          </button>
        ) : null}
      </div>
      <table className={s.cmpTable}>
        <thead>
          <tr><th>المرحلة</th><th>العدد</th><th>التكلفة</th><th>متوسط الحساب</th></tr>
        </thead>
        <tbody>
          {STAGES.filter((st) => st.key !== "landing_page_views" || funnel.has_landing).map((st) => (
            <tr key={st.key}>
              <td>{st.label}</td>
              <td>{fmtInt(funnel.counts[st.key])}</td>
              <td>{fmtMoney(funnel.costs[st.key], currency)}</td>
              <td className={s.hint}>{fmtMoney(benchmark.costs[st.key], currency)}</td>
            </tr>
          ))}
          {STEPS.filter((st) => st.key !== "lpv_rate" || funnel.has_landing).map((st) => (
            <tr key={st.key}>
              <td>{st.label}</td>
              <td colSpan={2} className={st.key === diagnosis.break_step ? s.bad : ""}>{fmtPct(funnel.steps[st.key])}</td>
              <td className={s.hint}>{fmtPct(benchmark.steps[st.key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SORTS = {
  spend: (it) => it.funnel.spend,
  roas: (it) => it.funnel.roas ?? -1,
  purchases: (it) => it.funnel.counts.purchases,
  cpa: (it) => it.funnel.costs.purchases ?? Infinity,
  atc: (it) => it.funnel.costs.add_to_cart ?? Infinity,
  checkout: (it) => it.funnel.costs.initiate_checkout ?? Infinity
};

export default function FunnelDashboard() {
  const [accounts, setAccounts] = useState([]);
  const [accountsError, setAccountsError] = useState("");
  const [accountId, setAccountId] = useState("");
  const [preset, setPreset] = useState("last_7d");
  const [since, setSince] = useState(riyadhDate(-6));
  const [until, setUntil] = useState(riyadhDate(0));
  const [level, setLevel] = useState("adsquad");
  const [drill, setDrill] = useState({ campaign: null, adsquad: null });
  const [target, setTarget] = useState(3);
  const [data, setData] = useState(null);
  const [ga4, setGa4] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState({ key: "spend", dir: -1 });
  const [open, setOpen] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = Number(getSetting("mf-funnel-target", "3"));
    if (Number.isFinite(t) && t > 0) setTarget(t);
    apiGet("/api/funnel?view=accounts")
      .then((res) => {
        const list = res.accounts || [];
        setAccounts(list);
        const saved = getSetting("mf-funnel-account", "");
        setAccountId(list.find((a) => a.id === saved) ? saved : list[0]?.id || "");
        if (!list.length) setAccountsError("مفيش حسابات Snapchat مربوطة في المساحة دي.");
      })
      .catch((e) => setAccountsError(e.message));
  }, []);

  const rangeQuery = useMemo(() => {
    if (preset === "custom") return `since=${since}&until=${until}`;
    return `date_preset=${preset}`;
  }, [preset, since, until]);

  const effectiveLevel = level === "ad" && !drill.campaign && !drill.adsquad ? "adsquad" : level;

  useEffect(() => {
    if (!accountId) return;
    if (preset === "custom" && (!since || !until || since > until)) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setOpen(null);
    const q = new URLSearchParams(rangeQuery);
    q.set("view", "snapchat");
    q.set("account_id", accountId);
    q.set("level", effectiveLevel);
    if (drill.adsquad && effectiveLevel === "ad") q.set("adsquad_id", drill.adsquad.id);
    else if (drill.campaign && effectiveLevel !== "campaign") q.set("campaign_id", drill.campaign.id);
    apiGet(`/api/funnel?${q.toString()}`, { timeoutMs: 65000 })
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) { setError(e.message); setData(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, rangeQuery, effectiveLevel, drill, reloadKey, preset, since, until]);

  useEffect(() => {
    let cancelled = false;
    apiGet(`/api/funnel?view=ga4&${rangeQuery}`)
      .then((res) => { if (!cancelled) setGa4(res.success ? res : { error: res.error }); })
      .catch((e) => { if (!cancelled) setGa4({ error: e.message }); });
    return () => { cancelled = true; };
  }, [rangeQuery, reloadKey]);

  const currency = data?.account?.currency || "USD";
  const analysis = useMemo(() => {
    if (!data?.rows) return null;
    return analyzeRows(data.rows, { summary: data.summary, targetRoas: target });
  }, [data, target]);

  const items = useMemo(() => {
    if (!analysis) return [];
    let list = analysis.items;
    if (statusFilter !== "all") list = list.filter((it) => (statusFilter === "active" ? it.status === "ACTIVE" : it.status !== "ACTIVE"));
    if (verdictFilter) list = list.filter((it) => it.diagnosis.verdict === verdictFilter);
    const fn = SORTS[sort.key] || SORTS.spend;
    return [...list].sort((a, b) => (fn(a) - fn(b)) * sort.dir);
  }, [analysis, verdictFilter, statusFilter, sort]);

  const chooseAccount = (id) => {
    setAccountId(id);
    saveSetting("mf-funnel-account", id);
    setDrill({ campaign: null, adsquad: null });
    setVerdictFilter("");
  };
  const chooseTarget = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) { setTarget(n); saveSetting("mf-funnel-target", String(n)); }
  };
  const chooseLevel = (v) => {
    setLevel(v);
    setVerdictFilter("");
    if (v === "campaign") setDrill({ campaign: null, adsquad: null });
    if (v === "adsquad") setDrill((d) => ({ campaign: d.campaign, adsquad: null }));
  };
  const drillInto = (item) => {
    setVerdictFilter("");
    if (effectiveLevel === "campaign") { setDrill({ campaign: { id: item.id, name: item.name }, adsquad: null }); setLevel("adsquad"); }
    else if (effectiveLevel === "adsquad") {
      setDrill((d) => ({ campaign: d.campaign || (item.campaign_id ? { id: item.campaign_id, name: item.campaign_name } : null), adsquad: { id: item.id, name: item.name } }));
      setLevel("ad");
    }
  };
  const toggleSort = (key) => setSort((cur) => ({ key, dir: cur.key === key ? -cur.dir : -1 }));

  const bench = analysis?.benchmark;
  const levelName = LEVELS.find((l) => l.value === effectiveLevel)?.label;
  const ga = ga4?.metrics;
  const snapPurchases = bench?.counts.purchases ?? 0;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}><span className={s.snapDot}><Ghost size={16} /></span> داش بورد الفانل</h1>
          <p className={s.subtitle}>نتايج Snapchat لايف بنفس أرقام Ads Manager (وقت التحويل، 28 يوم سوايب / يوم مشاهدة) مع تشخيص كل مجموعة إعلانية</p>
        </div>
        <div className={s.filters}>
          <select className={s.select} value={accountId} onChange={(e) => chooseAccount(e.target.value)} aria-label="الحساب">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button type="button" className={s.btn} onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            <RefreshCw size={14} className={loading ? s.spin : ""} /> تحديث
          </button>
        </div>
      </div>

      <div className={`${s.card} ${s.filters}`}>
        <div className={s.seg}>
          {PRESETS.map((p) => (
            <button key={p.value} type="button" className={`${s.segBtn} ${preset === p.value ? s.segActive : ""}`} onClick={() => setPreset(p.value)}>{p.label}</button>
          ))}
        </div>
        {preset === "custom" ? (
          <>
            <label className={s.label}>من <input type="date" className={s.input} value={since} max={until} onChange={(e) => setSince(e.target.value)} /></label>
            <label className={s.label}>إلى <input type="date" className={s.input} value={until} min={since} max={riyadhDate(0)} onChange={(e) => setUntil(e.target.value)} /></label>
          </>
        ) : null}
        <div className={s.seg}>
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              className={`${s.segBtn} ${effectiveLevel === l.value ? s.segActive : ""}`}
              onClick={() => chooseLevel(l.value)}
              disabled={l.value === "ad" && !drill.campaign && !drill.adsquad}
              title={l.value === "ad" && !drill.campaign && !drill.adsquad ? "افتح حملة أو مجموعة الأول عشان تشوف إعلاناتها" : ""}
            >{l.label}</button>
          ))}
        </div>
        <label className={s.label}>ROAS المستهدف <input type="number" step="0.1" min="0.1" className={`${s.input} ${s.inputSmall}`} value={target} onChange={(e) => chooseTarget(e.target.value)} /></label>
        <select className={s.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="الحالة">
          <option value="all">كل الحالات</option>
          <option value="active">الشغال بس</option>
          <option value="paused">المتوقف بس</option>
        </select>
      </div>

      {(drill.campaign || drill.adsquad) ? (
        <div className={s.crumbs}>
          <button type="button" className={s.crumb} onClick={() => { setDrill({ campaign: null, adsquad: null }); setLevel("campaign"); }}>كل الحساب</button>
          {drill.campaign ? (<><ChevronLeft size={13} />{drill.adsquad ? <button type="button" className={s.crumb} onClick={() => { setDrill((d) => ({ ...d, adsquad: null })); setLevel("adsquad"); }}>{drill.campaign.name}</button> : <span className={s.crumbCurrent}>{drill.campaign.name}</span>}</>) : null}
          {drill.adsquad ? (<><ChevronLeft size={13} /><span className={s.crumbCurrent}>{drill.adsquad.name}</span></>) : null}
        </div>
      ) : null}

      {accountsError ? <div className={`${s.banner} ${s.error}`}>{accountsError}</div> : null}
      {error ? <div className={`${s.banner} ${s.error}`}>تعذر تحميل بيانات Snapchat: {error}</div> : null}
      {data && data.complete === false ? (
        <div className={s.banner}>
          <Info size={13} /> الأرقام دي بتغطي {data.spend_coverage_pct ?? "—"}% من صرف الحساب بس (الحساب كبير والوقت خلص).
          {data.missing_campaigns?.length ? ` افتح الحملات من مستوى "الحملات" عشان تشوف مجموعاتها كاملة.` : " جرّب فترة أقصر أو افتح حملة واحدة."}
        </div>
      ) : null}

      {loading && !data ? <div className={`${s.card} ${s.loading}`}><RefreshCw size={18} className={s.spin} /> بنجيب الأرقام لايف من Snapchat… ممكن ياخد لحد دقيقة في الحسابات الكبيرة</div> : null}

      {bench ? (
        <>
          <div className={s.kpis} style={{ opacity: loading ? 0.55 : 1 }}>
            <Kpi label="الصرف" value={fmtMoney(bench.spend, currency)} sub={`${fmtInt(items.length)} ${levelName}`} />
            <Kpi label="المبيعات" value={fmtMoney(bench.revenue, currency)} />
            <Kpi label="ROAS" value={fmtRoas(bench.roas)} tone={roasBand(bench.roas, target)} sub={`المستهدف ${target}x`} />
            <Kpi label="المشتريات" value={fmtInt(bench.counts.purchases)} sub={`تكلفة الشراء ${fmtMoney(bench.costs.purchases, currency)}`} />
            <Kpi label="تكلفة الإضافة للسلة" value={fmtMoney(bench.costs.add_to_cart, currency)} sub={`${fmtInt(bench.counts.add_to_cart)} إضافة`} />
            <Kpi label="CTR" value={fmtPct(bench.steps.ctr)} sub={`CPM ${fmtMoney(bench.costs.impressions, currency)}`} />
            <Kpi
              label={<><Globe2 size={11} /> جلسات الموقع (GA4)</>}
              value={ga ? fmtInt(ga.sessions) : "—"}
              sub={ga ? `تحويل ${Number(ga.conversionRate || 0).toFixed(2)}% · ${fmtInt(ga.conversions)} تحويل` : ga4?.error ? "GA4 مش متاح" : "…"}
            />
          </div>
          {ga && ga.conversions ? (
            <div className={s.hint}>Snapchat بيقول {fmtInt(snapPurchases)} شراء، وGA4 شايف {fmtInt(ga.conversions)} تحويل على الموقع كله (كل المصادر) في نفس الفترة{ga4?.property_name ? ` · ${ga4.property_name}` : ""}.</div>
          ) : null}

          <div className={s.card}>
            <div className={s.cardTitle}>
              فانل {drill.adsquad ? drill.adsquad.name : drill.campaign ? drill.campaign.name : data?.account?.name}
              <span className={s.hint}>الأعمدة على مقياس لوغاريتمي. أحداث البيكسل مش متداخلة (مشاهدة المنتج وبدء الدفع بيتسجلوا أكتر من مرة)، فالنسب محسوبة من السوايب</span>
            </div>
            <AccountFunnel funnel={bench} currency={currency} />
          </div>

          <div className={s.card}>
            <div className={s.cardTitle}>
              <span><Filter size={14} /> قرارات {levelName}</span>
              <span className={s.legend}>
                <span><span className={s.good}>●</span> ROAS ≥ {target}</span>
                <span><span className={s.ok}>●</span> ≥ {(target * 0.67).toFixed(1)}</span>
                <span><span className={s.bad}>●</span> أقل</span>
              </span>
            </div>
            <div className={s.chips}>
              <button type="button" className={`${s.chip} ${!verdictFilter ? s.chipActive : ""}`} onClick={() => setVerdictFilter("")}>الكل ({analysis.items.length})</button>
              {VERDICTS.filter((v) => analysis.verdict_counts[v.key]).map((v) => (
                <button key={v.key} type="button" className={`${s.chip} ${verdictFilter === v.key ? s.chipActive : ""}`} onClick={() => setVerdictFilter(verdictFilter === v.key ? "" : v.key)}>
                  <span className={s[v.tone]}>●</span> {v.label} ({analysis.verdict_counts[v.key]})
                </button>
              ))}
            </div>
            <div className={s.tableWrap} style={{ marginTop: 12, opacity: loading ? 0.55 : 1 }}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th onClick={() => toggleSort("spend")}>الصرف {sort.key === "spend" ? (sort.dir < 0 ? "▼" : "▲") : ""}</th>
                    <th onClick={() => toggleSort("roas")}>ROAS {sort.key === "roas" ? (sort.dir < 0 ? "▼" : "▲") : ""}</th>
                    <th onClick={() => toggleSort("purchases")}>شراء {sort.key === "purchases" ? (sort.dir < 0 ? "▼" : "▲") : ""}</th>
                    <th>الفانل</th>
                    <th>CTR</th>
                    <th onClick={() => toggleSort("atc")}>تكلفة السلة {sort.key === "atc" ? (sort.dir < 0 ? "▼" : "▲") : ""}</th>
                    <th onClick={() => toggleSort("checkout")}>تكلفة الدفع {sort.key === "checkout" ? (sort.dir < 0 ? "▼" : "▲") : ""}</th>
                    <th onClick={() => toggleSort("cpa")}>تكلفة الشراء {sort.key === "cpa" ? (sort.dir < 0 ? "▼" : "▲") : ""}</th>
                    <th>بيقع فين</th>
                    <th>القرار</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <Fragment key={it.id}>
                      <tr className={s.rowClickable} onClick={() => setOpen(open === it.id ? null : it.id)}>
                        <td className={s.nameCell}>
                          <div className={s.nameMain} title={it.name}>{it.name}</div>
                          <div className={s.nameSub}>{STATUS_AR[it.status] || it.status || ""}{it.campaign_name && effectiveLevel !== "campaign" ? ` · ${it.campaign_name}` : ""}</div>
                        </td>
                        <td>{fmtMoney(it.funnel.spend, currency)}</td>
                        <td><RoasBadge roas={it.funnel.roas} target={target} /></td>
                        <td>{fmtInt(it.funnel.counts.purchases)}</td>
                        <td><MiniFunnel funnel={it.funnel} breakStep={it.diagnosis.break_step} /></td>
                        <td>{fmtPct(it.funnel.steps.ctr)}</td>
                        <CostCell value={it.funnel.costs.add_to_cart} avg={bench.costs.add_to_cart} currency={currency} />
                        <CostCell value={it.funnel.costs.initiate_checkout} avg={bench.costs.initiate_checkout} currency={currency} />
                        <CostCell value={it.funnel.costs.purchases} avg={bench.costs.purchases} currency={currency} />
                        <td>{it.diagnosis.break_area_label || <span className={s.neutral}>—</span>}</td>
                        <td className={s.actionCell}><span className={`${s.badge} ${s[it.diagnosis.tone]}`}>{it.diagnosis.verdict_label}</span></td>
                      </tr>
                      {open === it.id ? (
                        <tr><td colSpan={11}><Detail item={it} benchmark={bench} currency={currency} onDrill={drillInto} level={effectiveLevel} /></td></tr>
                      ) : null}
                    </Fragment>
                  ))}
                  {!items.length ? <tr><td colSpan={11} className={s.loading}>مفيش نتايج بالفلتر ده.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <p className={s.hint} style={{ marginTop: 10 }}>
              كل صف بيتقارن بمتوسط {drill.campaign || drill.adsquad ? "النطاق المفتوح" : "الحساب"} في نفس الفترة. "وقّف بدري" = تكلفة السلة أو الدفع أكتر من ضعف المتوسط بعد ما صرف قد تكلفة شراء.
              "استنى" = أول الفانل رخيص ولسه مفيش شراء. "زوّد" = 3 مشتريات أو أكتر وROAS فوق المستهدف ومفيش مرحلة ضعيفة، والزيادة 20% بس كل مرة. الداش بورد للقراءة بس، مبيغيرش حاجة في الحسابات.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
