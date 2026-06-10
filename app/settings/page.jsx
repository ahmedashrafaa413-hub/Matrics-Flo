"use client";
import { useState } from "react";
import { getSetting, saveSetting } from "../../lib/storage";

export default function SettingsPage() {
  const [whatsapp,  setWhatsapp]  = useState(getSetting("notify_whatsapp",""));
  const [email,     setEmail]     = useState(getSetting("notify_email",""));
  const [telegram,  setTelegram]  = useState(getSetting("notify_telegram",""));
  const [schedule,  setSchedule]  = useState(getSetting("report_schedule","weekly"));
  const [saved,     setSaved]     = useState(false);

  function save() {
    saveSetting("notify_whatsapp", whatsapp);
    saveSetting("notify_email",    email);
    saveSetting("notify_telegram", telegram);
    saveSetting("report_schedule", schedule);
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  }

  const fieldStyle = { width:"100%", background:"rgba(255,255,255,0.04)", border:"1px solid var(--border-2)", borderRadius:"var(--radius-md)", padding:"11px 14px", color:"var(--text)", fontSize:14, fontFamily:"inherit", outline:"none" };

  return (
    <main style={{ display:"flex", flexDirection:"column", gap:14, maxWidth:600 }}>
      <div>
        <span className="dash-badge">Settings</span>
        <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:24, fontWeight:700, color:"var(--text)", letterSpacing:"-0.3px", marginBottom:6 }}>Account Settings</h1>
        <p style={{ color:"var(--muted)", fontSize:14 }}>Notifications and report preferences</p>
      </div>

      <div className="dash-chart-card">
        <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:16, fontWeight:700, color:"var(--text)", marginBottom:16 }}>Notification Channels</h2>
        {[
          { icon:"💬", label:"WhatsApp", placeholder:"+966 5x xxx xxxx", value:whatsapp, set:setWhatsapp },
          { icon:"📧", label:"Email",    placeholder:"your@email.com",    value:email,    set:setEmail    },
          { icon:"✈️", label:"Telegram", placeholder:"Chat ID or @username", value:telegram, set:setTelegram },
        ].map(field=>(
          <div key={field.label} style={{ marginBottom:14 }}>
            <label style={{ display:"block", fontSize:12, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.8px", marginBottom:7 }}>
              {field.icon} {field.label}
            </label>
            <input style={fieldStyle} placeholder={field.placeholder} value={field.value} onChange={e=>field.set(e.target.value)} />
          </div>
        ))}
      </div>

      <div className="dash-chart-card">
        <h2 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:16, fontWeight:700, color:"var(--text)", marginBottom:16 }}>Report Schedule</h2>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {[{value:"daily",label:"Daily 8AM"},{value:"weekly",label:"Weekly Sunday"},{value:"monthly",label:"Monthly"}].map(opt=>(
            <button key={opt.value} onClick={()=>setSchedule(opt.value)} style={{ padding:"8px 16px", borderRadius:999, fontSize:13, fontWeight:700, border:`1px solid ${schedule===opt.value?"var(--primary)":"var(--border)"}`, background:schedule===opt.value?"rgba(99,102,241,0.12)":"transparent", color:schedule===opt.value?"var(--primary)":"var(--muted)", cursor:"pointer", fontFamily:"inherit" }}>{opt.label}</button>
          ))}
        </div>
      </div>

      <button onClick={save} style={{ background:"linear-gradient(135deg,var(--primary),#4f46e5)", color:"white", border:"none", padding:"12px 24px", borderRadius:"var(--radius-md)", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit", alignSelf:"flex-start", boxShadow:"0 0 20px rgba(99,102,241,0.25)" }}>
        {saved ? "✓ Saved!" : "Save Settings"}
      </button>
    </main>
  );
}
