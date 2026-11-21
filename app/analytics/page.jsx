"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrainCircuit,
  RefreshCw,
  TrendingUp,
  Wallet,
  ShoppingCart,
  BarChart2,
  BadgeDollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertTriangle,
  Megaphone,
  CalendarDays,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { apiGet } from "../../lib/api";
import { formatNumber, formatROAS, formatSAR } from "../../lib/currency";
import { getSetting } from "../../lib/storage";

const PRESETS = ["today", "yesterday", "last_7d", "last_30d", "this_month", "last_month"];

const DATES = {
  ar: {
    today: "اليوم",
    yesterday: "أمس",
    last_7d: "آخر 7 أيام",
    last_30d: "آخر 30 يوم",
    this_month: "هذا الشهر",
    last_month: "الشهر الماضي",
  },
  en: {
    today: "Today",
    yesterday: "Yesterday",
    last_7d: "Last 7 days",
    last_30d: "Last 30 days",
    this_month: "This month",
    last_month: "Last month",
  },
};

function present(value, formatter, fallback = "—") {
  return value === null || value === undefined ? fallback : formatter(value);
}

function Change({ metric, fallback }) {
  if (!metric || metric.percent === null) {
    return <span className="analytics-change neutral">{fallback}</span>;
  }

  const tone = metric.improved === null
    ? "neutral"
    : metric.improved
    ? "positive"
    : "negative";

  const Icon =
    metric.direction === "up"
      ? ArrowUpRight
      : metric.direction === "down"
      ? ArrowDownRight
      : Minus;

  return (
    <span className={`analytics-change ${tone}`}>
      <Icon size={10} />
      {Math.abs(metric.percent).toFixed(1)}%
    </span>
  );
}

function KPISkeleton() {
  return (
    <section className="analytics-kpis">
      {Array.from({ length: 5 }).map((_, i) => (
        <article key={i}>
          <div className="skeleton" style={{ height: 12, width: "55%", marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 26, width: "70%", marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 20, width: "35%", borderRadius: 999 }} />
          <div className="skeleton" style={{ height: 11, width: "50%", marginTop: 4 }} />
        </article>
      ))}
    </section>
  );
}

function TableSkeleton() {
  return (
    <div className="analytics-table-wrap">
      <table>
        <thead>
          <tr>
            {Array.from({ length: 8 }).map((_, i) => (
              <th key={i}>
                <div className="skeleton" style={{ height: 10, width: "60%" }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: 8 }).map((_, j) => (
                <td key={j}>
                  <div className="skeleton" style={{ height: 13, width: j === 1 ? "80%" : "55%" }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AnalyticsPage() {
  const { locale, t } = useLanguage();
  const [preset, setPreset] = useState("last_30d");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ date_preset: preset });
      const meta = getSetting("primary_meta_account", "");
      const snap = getSetting("primary_snapchat_account", "");
      if (meta) params.set("meta_account_id", meta);
      if (snap) params.set("snapchat_account_id", snap);
      setData(await apiGet(`/api/analytics/overview?${params}`));
    } catch (requestError) {
      setError(requestError.message || t("analytics.error"));
    } finally {
      setLoading(false);
    }
  }, [preset, t]);

  useEffect(() => { load(); }, [load]);

  const cards = useMemo(() => [
    { key: "spend",     label: t("analytics.spend"),     formatter: formatSAR,    Icon: Wallet },
    { key: "revenue",   label: t("analytics.revenue"),   formatter: formatSAR,    Icon: TrendingUp },
    { key: "purchases", label: t("analytics.purchases"), formatter: formatNumber, Icon: ShoppingCart },
    { key: "roas",      label: t("analytics.roas"),      formatter: formatROAS,   Icon: BarChart2 },
    { key: "cpa",       label: t("analytics.cpa"),       formatter: formatSAR,    Icon: BadgeDollarSign },
  ], [t]);

  return (
    <main className="analytics-page">

      {/* ── Header ── */}
      <header className="analytics-header">
        <div>
          <span className="analytics-eyebrow">
            <BrainCircuit size={11} style={{ marginInlineEnd: 5, verticalAlign: "middle" }} />
            MetricsFlo Analytics
          </span>
          <h1>{t("analytics.title")}</h1>
          <p>{t("analytics.subtitle")}</p>
        </div>

        <div className="analytics-actions">
          <div className="analytics-select-wrap">
            <CalendarDays size={14} className="analytics-select-icon" />
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((value) => (
                <option key={value} value={value}>
                  {DATES[locale][value]}
                </option>
              ))}
            </select>
          </div>

          <button type="button" onClick={load} disabled={loading} className="analytics-refresh-btn">
            <RefreshCw size={14} className={loading ? "analytics-spin" : ""} />
            {t("analytics.refresh")}
          </button>
        </div>
      </header>

      {/* ── Error ── */}
      {error && (
        <div className="analytics-alert error">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* ── KPI Cards ── */}
      {loading ? (
        <KPISkeleton />
      ) : data ? (
        <section className="analytics-kpis">
          {cards.map(({ key, label, formatter, Icon }) => {
            const metric = data.comparisons?.[key];
            return (
              <article key={key}>
                <span className="analytics-kpi-label">
                  <Icon size={13} style={{ opacity: 0.6 }} />
                  {label}
                </span>
                <strong>{present(metric?.current, formatter, t("analytics.unavailable"))}</strong>
                <Change metric={metric} fallback={t("analytics.unavailable")} />
                <small>
                  {t("analytics.previous")}:{" "}
                  {present(metric?.previous, formatter, t("analytics.unavailable"))}
                </small>
              </article>
            );
          })}
        </section>
      ) : null}

      {/* ── Data Quality Panel ── */}
      {!loading && data && (
        <section className="analytics-panel">
          <div className="analytics-panel-head">
            <div>
              <h2>{t("analytics.dataQuality")}</h2>
              <small style={{ color: "var(--muted)", fontSize: 12 }}>{data.workspace?.name}</small>
            </div>
            <span>{data.data_quality?.length || 0}</span>
          </div>

          {!data.data_quality?.length ? (
            <p className="analytics-empty">{t("analytics.noIssues")}</p>
          ) : (
            <div className="analytics-issues">
              {data.data_quality.map((issue, index) => (
                <div
                  key={`${issue.code}-${index}`}
                  className={`analytics-issue ${issue.severity}`}
                >
                  <strong>{issue.code.replaceAll("_", " ")}</strong>
                  <span>
                    {issue.source}
                    {issue.entity ? ` · ${issue.entity}` : ""}
                  </span>
                  <small>{issue.confidence}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Campaigns Panel ── */}
      <section className="analytics-panel">
        <div className="analytics-panel-head">
          <h2>
            <Megaphone size={16} style={{ marginInlineEnd: 7, opacity: 0.7, verticalAlign: "middle" }} />
            {t("analytics.campaigns")}
          </h2>
          <span>{data?.campaigns?.length || 0}</span>
        </div>

        {loading ? (
          <TableSkeleton />
        ) : !data?.campaigns?.length ? (
          <p className="analytics-empty">{t("analytics.noCampaigns")}</p>
        ) : (
          <div className="analytics-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("analytics.platform")}</th>
                  <th>{t("analytics.campaign")}</th>
                  <th>{t("analytics.spend")}</th>
                  <th>{t("analytics.revenue")}</th>
                  <th>{t("analytics.purchases")}</th>
                  <th>ROAS</th>
                  <th>CPA</th>
                  <th>CTR</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((row) => (
                  <tr key={`${row.platform}-${row.id}`}>
                    <td>{row.platform}</td>
                    <td>
                      <strong>{row.name || row.id}</strong>
                      <small>{row.status || "—"}</small>
                    </td>
                    <td>{present(row.spend, formatSAR)}</td>
                    <td>{present(row.revenue, formatSAR)}</td>
                    <td>{present(row.purchases, formatNumber)}</td>
                    <td>{present(row.roas, formatROAS)}</td>
                    <td>{present(row.cpa, formatSAR)}</td>
                    <td>{row.ctr === null ? "—" : `${row.ctr.toFixed(2)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Footer ── */}
      {!loading && data?.generated_at && (
        <footer className="analytics-generated">
          {t("analytics.lastGenerated")}:{" "}
          {new Intl.DateTimeFormat(
            locale === "ar" ? "ar-SA" : "en-US",
            { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }
          ).format(new Date(data.generated_at))}
        </footer>
      )}
    </main>
  );
}
