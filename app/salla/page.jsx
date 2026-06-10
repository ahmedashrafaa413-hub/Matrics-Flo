"use client";
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../lib/api";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

const fmt = {
  money:  (v,cur="SAR")=>`${Number(v||0).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})} ${cur}`,
  number: (v)=>Number(v||0).toLocaleString(),
  compact:(v)=>{const n=Number(v||0);return n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}K`:n.toLocaleString();},
};
const DATE_OPTIONS=[{value:"last_7d",label:"Last 7 Days"},{value:"last_30d",label:"Last 30 Days"},{value:"last_90d",label:"Last 90 Days"},{value:"this_month",label:"This Month"}];
const ChartTip=({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}><p style={{color:"var(--muted)",fontSize:11,marginBottom:6}}>{label}</p>{payload.map((p,i)=><p key={i} style={{color:p.color,fontWeight:700,fontSize:12}}>{p.name}: {typeof p.value==="number"?p.value.toLocaleString():p.value}</p>)}</div>);};

export default function SallaPage() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [dateRange,setDateRange]= useState("last_30d");

  useEffect(()=>{ load(); }, [dateRange]);

  async function load() {
    setLoading(true); setError("");
    try {
      const d = await apiGet(`/api/salla/orders?date_range=${dateRange}`);
      setData(d);
    } catch(e) {
      if (!e.message?.includes("NOT_CONNECTED")) setError(e.message);
      else setError("NOT_CONNECTED");
    } finally { setLoading(false); }
  }

  if (error==="NOT_CONNECTED") return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:300, gap:16 }}>
      <div style={{ fontSize:40 }}>🛍️</div>
      <div style={{ fontSize:18, fontWeight:700, color:"var(--text)", fontFamily:"'Space Grotesk',sans-serif" }}>Salla not connected</div>
      <p style={{ color:"var(--muted)", fontSize:14, textAlign:"center" }}>Connect your Salla store to see orders, revenue, and real ROAS.</p>
      <a href="/connections" style={{ background:"linear-gradient(135deg,var(--primary),#4f46e5)", color:"white", padding:"10px 20px", borderRadius:"var(--radius-md)", fontWeight:700, fontSize:13, textDecoration:"none" }}>Go to Connections →</a>
    </div>
  );

  const totals    = data?.totals || {};
  const daily     = data?.daily_revenue || [];
  const products  = data?.top_products  || [];
  const statuses  = data?.status_breakdown || {};

  return (
    <main style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:"#7C3AED20", border:"1px solid #7C3AED40", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:900, color:"#7C3AED" }}>س</div>
          <div>
            <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:20, fontWeight:700, color:"var(--text)" }}>Salla Store</h1>
            <p style={{ fontSize:12, color:"var(--muted)" }}>{data?.success ? `${data.date_range?.from} → ${data.date_range?.to}` : "Loading..."}</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <select value={dateRange} onChange={e=>setDateRange(e.target.value)} style={{ background:"var(--card)", color:"var(--text)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"8px 12px", fontSize:12, fontWeight:600, fontFamily:"inherit", outline:"none", cursor:"pointer" }}>
            {DATE_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="dash-refresh" onClick={load} disabled={loading}>{loading?"⏳":"↺"} Refresh</button>
        </div>
      </div>

      {error && error!=="NOT_CONNECTED" && <div className="dash-message error">⚠ {error}</div>}

      <div className="dash-kpi-grid" style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
        {[
          { label:"Revenue",   value:loading?"—":fmt.compact(totals.revenue)+" SAR", color:"#06d6a0", icon:"💵" },
          { label:"Orders",    value:loading?"—":fmt.number(totals.orders),           color:"#6366f1", icon:"📦" },
          { label:"Avg Order", value:loading?"—":fmt.compact(totals.avg_order_value)+" SAR", color:"#f59e0b", icon:"🧾" },
          { label:"Products",  value:loading?"—":fmt.number(totals.products_count),   color:"#8b5cf6", icon:"🏷️" },
        ].map(k=>(
          <div key={k.label} className="dash-kpi-card" style={{ position:"relative" }}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:k.color, borderRadius:"20px 20px 0 0" }} />
            <div className="dash-kpi-top"><span className="dash-kpi-label">{k.label}</span><span className="dash-kpi-icon">{k.icon}</span></div>
            <strong style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:22 }}>{k.value}</strong>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:14 }}>
        <div className="dash-chart-card">
          <div className="dash-chart-head"><div><h2>Daily Revenue</h2><p>{DATE_OPTIONS.find(d=>d.value===dateRange)?.label}</p></div></div>
          <div className="dash-chart-box">
            {daily.length===0 ? <div className="dash-empty"><h3>{loading?"⏳ Loading...":"No data"}</h3></div> :
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily.map(d=>({ date:d.date.slice(5), revenue:d.revenue, orders:d.orders }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted)" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill:"rgba(124,58,237,0.04)" }} />
                <Bar dataKey="revenue" name="Revenue (SAR)" fill="#7C3AED" radius={[5,5,0,0]} />
              </BarChart>
            </ResponsiveContainer>}
          </div>
        </div>
        <div className="dash-chart-card">
          <div className="dash-chart-head"><div><h2>Order Status</h2></div></div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:4 }}>
            {Object.entries(statuses).sort((a,b)=>b[1]-a[1]).map(([st,count])=>{
              const total=Object.values(statuses).reduce((s,v)=>s+v,0);
              const pct=total?(count/total*100).toFixed(0):0;
              return (
                <div key={st}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:3 }}>
                    <span style={{ color:"var(--text-2)" }}>{st}</span>
                    <span style={{ color:"var(--text)", fontWeight:700 }}>{count} <span style={{ color:"var(--muted)", fontWeight:400 }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height:5, background:"var(--border)", borderRadius:3, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, background:"#7C3AED", borderRadius:3 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="dash-table-card">
        <div className="dash-table-head"><div><h2>Top Products</h2><p>By revenue</p></div></div>
        {products.length===0 ? <div className="dash-empty"><h3>{loading?"⏳ Loading...":"No data"}</h3></div> :
        <div className="dash-table-scroll">
          <table className="dash-data-table">
            <thead><tr><th>Product</th><th>Quantity</th><th>Revenue</th><th>% of Total</th></tr></thead>
            <tbody>
              {products.map((p,i)=>{
                const totalRev=products.reduce((s,x)=>s+x.revenue,0);
                const pct=totalRev?(p.revenue/totalRev*100).toFixed(1):0;
                return (
                  <tr key={i}>
                    <td className="dash-name-cell">{p.name}</td>
                    <td>{fmt.number(p.quantity)}</td>
                    <td style={{ fontWeight:700, color:"var(--accent)" }}>{fmt.compact(p.revenue)} SAR</td>
                    <td>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ flex:1, height:4, background:"var(--border)", borderRadius:2, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${pct}%`, background:"#7C3AED", borderRadius:2 }} />
                        </div>
                        <span style={{ fontSize:11, color:"var(--muted)", minWidth:30 }}>{pct}%</span>
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
