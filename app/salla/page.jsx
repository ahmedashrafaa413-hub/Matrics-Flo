"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiGet } from "../../lib/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

// Live Salla store page: every number is read from the Salla API when the
// page loads (no "Sync Orders" step).

const fmt = {
  money: (v) => `${Number(v || 0).toLocaleString("en", { maximumFractionDigits: 0 })} SAR`,
  number: (v) => Number(v || 0).toLocaleString("en"),
  pct: (v) => `${Number(v || 0).toLocaleString("en", { maximumFractionDigits: 1 })}%`
};

const DATE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_30d", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
  { value: "custom", label: "Custom range" }
];

const ACCOUNT_KEY = "metricsflo.salla.adAccounts";
const BRAND_HINT = /lord|لورد/i;

function readSavedAccounts() {
  try {
    return JSON.parse(window.localStorage.getItem(ACCOUNT_KEY) || "null");
  } catch {
    return null;
  }
}

function saveAccounts(value) {
  try {
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(value));
  } catch {}
}

function riyadhToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
      <p style={{ color: "var(--muted)", fontSize: 11, marginBottom: 6 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontWeight: 700, fontSize: 12 }}>{p.name}: {Number(p.value || 0).toLocaleString("en")}</p>
      ))}
    </div>
  );
};

function BarList({ rows, valueKey = "count", extra }) {
  const total = rows.reduce((s, r) => s + Number(r[valueKey] || 0), 0);
  if (!rows.length) return <div className="dash-empty"><h3>No data</h3></div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {rows.map((row) => {
        const pct = total ? (Number(row[valueKey] || 0) / total) * 100 : 0;
        return (
          <div key={row.name}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3, gap: 8 }}>
              <span style={{ color: "var(--text-2)" }}>{row.name}</span>
              <span style={{ color: "var(--text)", fontWeight: 700, whiteSpace: "nowrap" }}>
                {fmt.number(row[valueKey])} <span style={{ color: "var(--muted)", fontWeight: 400 }}>({pct.toFixed(0)}%){extra ? ` · ${extra(row)}` : ""}</span>
              </span>
            </div>
            <div style={{ height: 5, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "#7C3AED", borderRadius: 3 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const selectStyle = { background: "var(--card)", color: "var(--text)", border: "1px solid var(--border-2)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: 12, fontWeight: 600, fontFamily: "inherit", outline: "none", cursor: "pointer" };

export default function SallaPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("today");
  const [since, setSince] = useState(riyadhToday());
  const [until, setUntil] = useState(riyadhToday());

  const [accounts, setAccounts] = useState({ snapchat: [], meta: [] });
  const [picked, setPicked] = useState({ snapchat: "none", meta: "none" });
  const [ads, setAds] = useState(null);
  const [adsLoading, setAdsLoading] = useState(false);
  const [adsError, setAdsError] = useState("");

  const query = useMemo(() => {
    if (preset === "custom") return `since=${since}&until=${until}`;
    return `date_preset=${preset}`;
  }, [preset, since, until]);

  useEffect(() => { load(); }, [query]);

  useEffect(() => {
    apiGet("/api/salla/live?view=accounts")
      .then((res) => {
        const list = { snapchat: res?.snapchat || [], meta: res?.meta || [] };
        setAccounts(list);
        const saved = readSavedAccounts();
        const guess = (rows) => rows.find((a) => BRAND_HINT.test(a.name || ""))?.id || "none";
        setPicked(saved || { snapchat: guess(list.snapchat), meta: guess(list.meta) });
      })
      .catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    setAds(null);
    try {
      const d = await apiGet(`/api/salla/live?view=store&${query}`, { timeoutMs: 65_000 });
      setData(d);
    } catch (e) {
      setData(null);
      setError(e.message?.includes("NOT_CONNECTED") ? "NOT_CONNECTED" : e.message || "Failed to load Salla");
    } finally {
      setLoading(false);
    }
  }

  async function loadAds() {
    if (picked.snapchat === "none" && picked.meta === "none") {
      setAdsError("Pick the store's Snapchat or Meta ad account first.");
      return;
    }
    saveAccounts(picked);
    setAdsLoading(true);
    setAdsError("");
    try {
      const qs = `${query}&snapchat_account_id=${encodeURIComponent(picked.snapchat)}&meta_account_id=${encodeURIComponent(picked.meta)}`;
      const res = await apiGet(`/api/salla/live?view=ads&${qs}`, { timeoutMs: 65_000 });
      setAds(res);
    } catch (e) {
      setAdsError(e.message || "Failed to load ad platforms");
    } finally {
      setAdsLoading(false);
    }
  }

  if (error === "NOT_CONNECTED") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, gap: 16 }}>
      <div style={{ fontSize: 40 }}>🛍️</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontFamily: "'Space Grotesk',sans-serif" }}>Salla not connected</div>
      <p style={{ color: "var(--muted)", fontSize: 14, textAlign: "center" }}>Connect your Salla store to see orders, revenue, and real ROAS.</p>
      <a href="/connections" style={{ background: "linear-gradient(135deg,var(--primary),#4f46e5)", color: "white", padding: "10px 20px", borderRadius: "var(--radius-md)", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>Go to Connections →</a>
    </div>
  );

  const totals = data?.totals || {};
  const carts = data?.abandoned_carts;
  const cmp = ads?.comparison;
  const hasProductRevenue = (data?.products || []).some((p) => Number(p.revenue) > 0);

  const kpis = [
    { label: "Orders", value: fmt.number(totals.valid_orders), sub: totals.void_orders ? `${fmt.number(totals.void_orders)} cancelled/returned` : "", color: "#6366f1", icon: "📦" },
    { label: "Revenue", value: fmt.money(totals.revenue), sub: "excl. cancelled", color: "#06d6a0", icon: "💵" },
    { label: "Avg Order", value: fmt.money(totals.avg_order_value), sub: `${fmt.pct(totals.multi_item_pct)} multi-item`, color: "#f59e0b", icon: "🧾" },
    {
      label: "Abandoned Carts",
      value: carts ? (carts.in_range ? `${fmt.number(carts.in_range.count)}${carts.complete ? "" : "+"}` : fmt.number(carts.open_total.count)) : "—",
      sub: carts && !carts.in_range
        ? `${fmt.money(carts.open_total.value)} · open right now`
        : carts
        ? `${carts.complete ? "" : "at least "}${fmt.money(carts.in_range.value)} · ${fmt.number(carts.open_total.count)}${carts.complete ? "" : "+"} open in total${carts.complete ? "" : " (first 650 carts only)"}`
        : (data?.abandoned_carts_error ? "not available" : ""),
      color: "#ef4444",
      icon: "🧺"
    }
  ];

  return (
    <main style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#7C3AED20", border: "1px solid #7C3AED40", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 900, color: "#7C3AED" }}>س</div>
          <div>
            <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{data?.store?.name || "Salla Store"}</h1>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>
              {loading ? "Loading live data from Salla…" : data?.success ? `${data.date_range.since} → ${data.date_range.until} · ${data.source === "crm" ? "from CRM" : "live from Salla"} ${new Date(data.fetched_at).toLocaleTimeString("en", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} style={selectStyle}>
            {DATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {preset === "custom" && (
            <>
              <input type="date" value={since} max={until} onChange={(e) => setSince(e.target.value)} style={selectStyle} />
              <input type="date" value={until} min={since} max={riyadhToday()} onChange={(e) => setUntil(e.target.value)} style={selectStyle} />
            </>
          )}
          <button className="dash-refresh" onClick={load} disabled={loading}>{loading ? "⏳" : "↺"} Refresh</button>
        </div>
      </div>

      {error && <div className="dash-message error" style={{ display: "flex", alignItems: "center", gap: 7 }}><AlertTriangle size={14} /> {error}</div>}
      {data?.success && !data.complete && <div className="dash-message">Salla is slow right now: this shows the first {fmt.number(totals.orders)} orders of the range. Pick a shorter range for exact totals.</div>}
      {data?.abandoned_carts_error && <div className="dash-message">{data.abandoned_carts_error}</div>}

      <div className="dash-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {kpis.map((k) => (
          <div key={k.label} className="dash-kpi-card" style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: k.color, borderRadius: "20px 20px 0 0" }} />
            <div className="dash-kpi-top"><span className="dash-kpi-label">{k.label}</span><span className="dash-kpi-icon">{k.icon}</span></div>
            <strong style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 22 }}>{loading ? "—" : k.value}</strong>
            {!loading && k.sub && <span style={{ fontSize: 11, color: "var(--muted)" }}>{k.sub}</span>}
          </div>
        ))}
      </div>

      <div className="dash-chart-card">
        <div className="dash-chart-head" style={{ flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2>Store orders vs ad platforms</h2>
            <p>Orders Salla recorded compared with purchases Snapchat and Meta claim for the same days</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={picked.snapchat} onChange={(e) => setPicked({ ...picked, snapchat: e.target.value })} style={selectStyle}>
              <option value="none">Snapchat: none</option>
              {accounts.snapchat.map((a) => <option key={a.id} value={a.id}>Snapchat: {a.name}</option>)}
            </select>
            <select value={picked.meta} onChange={(e) => setPicked({ ...picked, meta: e.target.value })} style={selectStyle}>
              <option value="none">Meta: none</option>
              {accounts.meta.map((a) => <option key={a.id} value={a.id}>Meta: {a.name}</option>)}
            </select>
            <button className="dash-refresh" onClick={loadAds} disabled={adsLoading || loading}>{adsLoading ? "⏳ Comparing" : "Compare"}</button>
          </div>
        </div>
        {adsError && <div className="dash-message error">{adsError}</div>}
        {cmp?.partial && <div className="dash-message">Salla did not return all orders for this range in time, so the comparison below is incomplete. Pick a shorter range for exact numbers.</div>}
        {cmp && (
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead><tr><th>Source</th><th>Orders / purchases</th><th>Share of store orders</th><th>Revenue</th><th>Spend</th></tr></thead>
              <tbody>
                <tr>
                  <td className="dash-name-cell">Salla store (actual)</td>
                  <td style={{ fontWeight: 700 }}>{fmt.number(cmp.store_orders)}</td>
                  <td>100%</td>
                  <td>{fmt.money(cmp.store_revenue)}</td>
                  <td>—</td>
                </tr>
                {cmp.platforms.map((p) => (
                  <tr key={p.platform}>
                    <td className="dash-name-cell" style={{ textTransform: "capitalize" }}>{p.platform} (claimed)</td>
                    <td style={{ fontWeight: 700 }}>{fmt.number(p.purchases)}</td>
                    <td style={{ color: p.share_of_store_orders_pct > 80 ? "#ef4444" : "var(--text)" }}>{fmt.pct(p.share_of_store_orders_pct)}</td>
                    <td>{fmt.money(p.revenue_sar)}</td>
                    <td>{fmt.money(p.spend_sar)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="dash-name-cell">All platforms claimed</td>
                  <td style={{ fontWeight: 700, color: cmp.over_attributed ? "#ef4444" : "var(--text)" }}>{fmt.number(cmp.claimed_purchases)}</td>
                  <td style={{ color: cmp.over_attributed ? "#ef4444" : "var(--text)" }}>{fmt.pct(cmp.claimed_share_pct)}</td>
                  <td>—</td>
                  <td>{fmt.money(cmp.total_ad_spend_sar)}</td>
                </tr>
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
              Real (blended) cost per order: <strong style={{ color: "var(--text)" }}>{fmt.money(cmp.blended_cpa_sar)}</strong> · Real ROAS from store revenue: <strong style={{ color: "var(--text)" }}>{cmp.blended_roas}</strong>
              {cmp.partial ? "" : cmp.over_attributed ? " · The platforms claim more orders than the store received, so they are counting the same orders." : ` · ${fmt.number(cmp.unattributed_orders)} store orders not claimed by any platform.`}
            </p>
            {ads?.errors?.length > 0 && <p style={{ fontSize: 11, color: "#f59e0b" }}>{ads.errors.map((e) => `${e.platform}: ${e.error}`).join(" · ")}</p>}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
        <div className="dash-chart-card" style={{ gridColumn: "1 / -1" }}>
          <div className="dash-chart-head"><div><h2>Daily Orders & Revenue</h2><p>Revenue excludes cancelled orders</p></div></div>
          <div className="dash-chart-box">
            {!data?.daily?.length && data?.monthly?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly.map((m) => ({ date: m.month, revenue: m.revenue, orders: m.orders }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="rev" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="ord" orientation="right" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(124,58,237,0.04)" }} />
                  <Bar yAxisId="rev" dataKey="revenue" name="Revenue (SAR)" fill="#7C3AED" radius={[5, 5, 0, 0]} />
                  <Bar yAxisId="ord" dataKey="orders" name="Orders" fill="#06d6a0" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : !data?.daily?.length ? <div className="dash-empty"><h3>{loading ? "⏳ Loading..." : "No data"}</h3></div> :
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily.map((d) => ({ date: d.date.slice(5), revenue: d.revenue, orders: d.orders }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="rev" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="ord" orientation="right" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(124,58,237,0.04)" }} />
                  <Bar yAxisId="rev" dataKey="revenue" name="Revenue (SAR)" fill="#7C3AED" radius={[5, 5, 0, 0]} />
                  <Bar yAxisId="ord" dataKey="orders" name="Orders" fill="#06d6a0" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>}
          </div>
        </div>
        <div className="dash-chart-card">
          <div className="dash-chart-head"><div><h2>Payment Methods</h2></div></div>
          <BarList rows={data?.payments || []} extra={(r) => fmt.money(r.revenue)} />
        </div>
        <div className="dash-chart-card">
          <div className="dash-chart-head"><div><h2>Order Status</h2></div></div>
          <BarList rows={data?.statuses || []} />
        </div>
        {data?.segments?.length > 0 && (
          <div className="dash-chart-card">
            <div className="dash-chart-head"><div><h2>Customers</h2><p>New vs returning buyers</p></div></div>
            <BarList rows={data.segments} />
          </div>
        )}
        {data?.cities?.length > 0 && (
          <div className="dash-chart-card">
            <div className="dash-chart-head"><div><h2>Top Cities</h2></div></div>
            <BarList rows={data.cities} extra={(r) => fmt.money(r.revenue)} />
          </div>
        )}
      </div>

      {data?.insights?.length > 0 && (
        <div className="dash-chart-card">
          <div className="dash-chart-head"><div><h2>Insights</h2><p>From the CRM</p></div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.insights.map((i) => (
              <div key={i.title} dir="auto" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 700, fontSize: 13 }}>
                  <span>{i.icon} {i.title}</span>
                  {i.stat && <span style={{ color: i.level === "warn" ? "#f59e0b" : "#06d6a0" }}>{i.stat}</span>}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4 }}>{i.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dash-table-card">
        <div className="dash-table-head"><div><h2>Top Products</h2><p>By number of orders</p></div></div>
        {!data?.products?.length ? <div className="dash-empty"><h3>{loading ? "⏳ Loading..." : "No data"}</h3></div> :
          <div className="dash-table-scroll">
            <table className="dash-data-table">
              <thead><tr><th>Product</th><th>Orders</th><th>Units</th>{hasProductRevenue && <th>Revenue</th>}<th>% of orders</th></tr></thead>
              <tbody>
                {data.products.map((p) => {
                  const pct = totals.orders ? (p.orders / totals.orders) * 100 : 0;
                  return (
                    <tr key={p.name}>
                      <td className="dash-name-cell">{p.name}</td>
                      <td style={{ fontWeight: 700 }}>{fmt.number(p.orders)}</td>
                      <td>{fmt.number(p.units)}</td>
                      {hasProductRevenue && <td style={{ fontWeight: 700, color: "var(--accent)" }}>{fmt.money(p.revenue)}</td>}
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: "#7C3AED", borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 30 }}>{pct.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
      </div>
    </main>
  );
}
