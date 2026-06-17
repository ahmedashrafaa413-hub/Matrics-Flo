"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const CSS = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg:      #080c14; --panel:  #0d1320;
    --border:  rgba(255,255,255,0.06); --accent: #6d5cff;
    --accent2: #00e5c3; --gold:   #f5c842; --snap: #fffc00;
    --text:    #f0f2f8; --muted:  #5a6480; --muted2: #8892aa;
    --danger:  #ff4d6d; --card:   rgba(255,255,255,0.03);
  }
  html, body { height: 100%; font-family: 'Space Grotesk', sans-serif; background: var(--bg); color: var(--text); overflow: hidden; }
  #mf-canvas { position: fixed; inset: 0; z-index: 0; opacity: 0.55; }
  .mf-grid { position: fixed; inset: 0; z-index: 1; background-image: linear-gradient(rgba(109,92,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(109,92,255,0.04) 1px, transparent 1px); background-size: 60px 60px; pointer-events: none; }
  .mf-layout { position: relative; z-index: 10; display: grid; grid-template-columns: 1fr 480px; height: 100vh; }
  .mf-hero { display: flex; flex-direction: column; justify-content: space-between; padding: 48px 56px; position: relative; overflow: hidden; }
  .mf-hero::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 1px; background: linear-gradient(to bottom, transparent, rgba(109,92,255,0.4) 30%, rgba(0,229,195,0.3) 70%, transparent); }
  .mf-logo { display: flex; align-items: center; gap: 10px; }
  .mf-logo-mark { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, var(--accent), var(--accent2)); display: flex; align-items: center; justify-content: center; font-family: 'Space Mono', monospace; font-size: 14px; font-weight: 700; color: #fff; letter-spacing: -1px; }
  .mf-logo-name { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
  .mf-logo-name span { color: var(--accent2); }
  .mf-hero-center { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 40px 0; }
  .mf-eyebrow { font-family: 'Space Mono', monospace; font-size: 11px; letter-spacing: 3px; color: var(--accent2); text-transform: uppercase; margin-bottom: 24px; display: flex; align-items: center; gap: 10px; }
  .mf-eyebrow::before { content: ''; display: block; width: 28px; height: 1px; background: var(--accent2); }
  .mf-headline { font-size: clamp(36px, 3.5vw, 54px); font-weight: 700; line-height: 1.1; letter-spacing: -1.5px; margin-bottom: 24px; }
  .mf-headline .hl { background: linear-gradient(90deg, var(--accent), var(--accent2)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .mf-sub { font-size: 16px; color: var(--muted2); line-height: 1.6; max-width: 480px; margin-bottom: 48px; }
  .mf-live-strip { display: flex; gap: 32px; padding: 20px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); margin-bottom: 48px; }
  .mf-stat { display: flex; flex-direction: column; gap: 4px; }
  .mf-stat-val { font-family: 'Space Mono', monospace; font-size: 22px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 6px; }
  .mf-stat-val .up { color: var(--accent2); font-size: 12px; }
  .mf-stat-val .dn { color: var(--danger); font-size: 12px; }
  .mf-stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.5px; }
  .mf-platforms { display: flex; align-items: center; gap: 12px; }
  .mf-plat-label { font-size: 12px; color: var(--muted); margin-right: 4px; }
  .mf-badge { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 1px solid var(--border); background: var(--card); transition: border-color 0.2s, transform 0.2s; cursor: default; }
  .mf-badge:hover { border-color: rgba(109,92,255,0.4); transform: translateY(-2px); }
  .mf-mini-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 32px; }
  .mf-mc { background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; position: relative; overflow: hidden; }
  .mf-mc::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px; border-radius: 12px 12px 0 0; }
  .mf-mc.c1::before { background: linear-gradient(90deg, var(--accent), transparent); }
  .mf-mc.c2::before { background: linear-gradient(90deg, var(--accent2), transparent); }
  .mf-mc.c3::before { background: linear-gradient(90deg, var(--gold), transparent); }
  .mf-mc.c4::before { background: linear-gradient(90deg, var(--snap), transparent); }
  .mf-mc-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; }
  .mf-mc-val { font-family: 'Space Mono', monospace; font-size: 18px; font-weight: 700; margin-bottom: 8px; }
  .mf-mc-bars { display: flex; align-items: flex-end; gap: 3px; height: 32px; }
  .mf-bar { flex: 1; border-radius: 2px 2px 0 0; opacity: 0.7; animation: barGrow 1s ease-out forwards; transform-origin: bottom; }
  @keyframes barGrow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  .mf-roas-ticker { display: inline-flex; align-items: center; gap: 8px; background: rgba(0,229,195,0.08); border: 1px solid rgba(0,229,195,0.2); border-radius: 999px; padding: 6px 14px; font-size: 12px; color: var(--accent2); font-family: 'Space Mono', monospace; margin-bottom: 28px; width: fit-content; }
  .mf-blink { width: 6px; height: 6px; border-radius: 50%; background: var(--accent2); animation: blink 1.4s step-end infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  .mf-auth { background: var(--panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; justify-content: center; padding: 56px 48px; position: relative; }
  .mf-auth::before { content: ''; position: absolute; top: -200px; right: -100px; width: 400px; height: 400px; background: radial-gradient(circle, rgba(109,92,255,0.12) 0%, transparent 70%); pointer-events: none; }
  .mf-auth::after { content: ''; position: absolute; bottom: -150px; left: -100px; width: 350px; height: 350px; background: radial-gradient(circle, rgba(0,229,195,0.08) 0%, transparent 70%); pointer-events: none; }
  .mf-auth-title { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 6px; }
  .mf-auth-sub { font-size: 14px; color: var(--muted2); margin-bottom: 36px; }
  .mf-field { margin-bottom: 18px; position: relative; }
  .mf-field label { display: block; font-size: 12px; font-weight: 600; color: var(--muted2); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .mf-field-wrap { position: relative; }
  .mf-field-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 15px; pointer-events: none; }
  .mf-field input { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 10px; padding: 13px 14px 13px 42px; color: var(--text); font-family: 'Space Grotesk', sans-serif; font-size: 14px; outline: none; transition: border-color 0.2s, background 0.2s, box-shadow 0.2s; }
  .mf-field input::placeholder { color: var(--muted); }
  .mf-field input:focus { border-color: rgba(109,92,255,0.5); background: rgba(109,92,255,0.05); box-shadow: 0 0 0 3px rgba(109,92,255,0.1); }
  .mf-field-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
  .mf-remember { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--muted2); user-select: none; }
  .mf-checkbox { width: 16px; height: 16px; border: 1px solid var(--border); border-radius: 4px; background: var(--card); display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; }
  .mf-checkbox.checked { background: var(--accent); border-color: var(--accent); }
  .mf-forgot { font-size: 13px; color: var(--accent); text-decoration: none; transition: color 0.2s; }
  .mf-forgot:hover { color: var(--accent2); }
  .mf-btn-primary { width: 100%; padding: 14px; background: linear-gradient(135deg, var(--accent), #5548e8); border: none; border-radius: 10px; color: white; font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 700; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; position: relative; overflow: hidden; margin-bottom: 14px; }
  .mf-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 32px rgba(109,92,255,0.4); }
  .mf-btn-primary:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
  .mf-divider { display: flex; align-items: center; gap: 14px; margin: 10px 0 14px; }
  .mf-divider-line { flex: 1; height: 1px; background: var(--border); }
  .mf-divider-text { font-size: 12px; color: var(--muted); }
  .mf-btn-sso { width: 100%; padding: 13px; background: transparent; border: 1px solid var(--border); border-radius: 10px; color: var(--muted2); font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 500; cursor: pointer; transition: border-color 0.2s, color 0.2s, background 0.2s; display: flex; align-items: center; justify-content: center; gap: 10px; }
  .mf-btn-sso:hover { border-color: rgba(109,92,255,0.4); color: var(--text); background: rgba(109,92,255,0.05); }
  .mf-signup-row { text-align: center; margin-top: 28px; font-size: 13px; color: var(--muted); }
  .mf-signup-row a { color: var(--accent2); text-decoration: none; font-weight: 600; }
  .mf-trust-row { display: flex; align-items: center; justify-content: center; gap: 20px; margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--border); }
  .mf-trust-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
  .mf-trust-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent2); box-shadow: 0 0 6px var(--accent2); }
  .mf-live-ind { position: absolute; top: 24px; right: 24px; display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--accent2); font-family: 'Space Mono', monospace; }
  .mf-live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent2); animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(0,229,195,0.6);opacity:1} 50%{box-shadow:0 0 0 6px rgba(0,229,195,0);opacity:0.7} }
  .mf-error { background: rgba(255,77,109,0.1); border: 1px solid rgba(255,77,109,0.3); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #ff4d6d; margin-bottom: 16px; }
  .fade-up { opacity: 0; transform: translateY(20px); animation: fadeUp 0.6s ease-out forwards; }
  @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
  .d1{animation-delay:0.1s} .d2{animation-delay:0.2s} .d3{animation-delay:0.3s} .d4{animation-delay:0.4s} .d5{animation-delay:0.5s} .d6{animation-delay:0.6s}
  @media(max-width:900px){ .mf-layout{grid-template-columns:1fr} .mf-hero{display:none} .mf-auth{padding:40px 28px} body{overflow:auto} }
`;

export default function LoginPage() {
  const [email,     setEmail]     = useState("");
  const [password,  setPassword]  = useState("");
  const [remember,  setRemember]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); setLoading(false); return; }
      setSuccess(true);
      window.location.href = "/dashboard";
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  async function handleGoogle() {
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options:  { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (err) setError(err.message);
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/>

      <canvas id="mf-canvas" />
      <div className="mf-grid" />

      <div className="mf-layout">

        {/* ══ LEFT HERO ══ */}
        <div className="mf-hero">
          <div className="mf-logo fade-up">
            <div className="mf-logo-mark">Mf</div>
            <div className="mf-logo-name">Metrics<span>Flo</span></div>
          </div>

          <div className="mf-hero-center">
            <div className="mf-roas-ticker fade-up d1">
              <span className="mf-blink" />
              LIVE — Saudi Market · Real-Time Intelligence
            </div>

            <p className="mf-eyebrow fade-up d2">AI-Powered Performance Engine</p>

            <h1 className="mf-headline fade-up d2">
              Stop reading<br/>
              dashboards.<br/>
              Start getting<br/>
              <span className="hl">decisions.</span>
            </h1>

            <p className="mf-sub fade-up d3">
              MetricsFlo unifies Meta, Snapchat, TikTok, Google and Salla into one Arabic-first intelligence platform — built for the Saudi and Egyptian performance marketer.
            </p>

            <div className="mf-live-strip fade-up d3">
              {[
                { id:"s-roas",  label:"Avg ROAS",   suffix:<span className="up">↑</span> },
                { id:"s-spend", label:"SAR Managed", suffix:null },
                { id:"s-cpa",   label:"Avg CPA",     suffix:<span className="dn">↓</span> },
                { id:"s-ctr",   label:"Hook Rate",   suffix:null },
              ].map(s => (
                <div key={s.id} className="mf-stat">
                  <div className="mf-stat-val" id={s.id}>—{s.suffix}</div>
                  <div className="mf-stat-label">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="mf-mini-charts fade-up d4">
              {[
                { cls:"c1", label:"Meta ROAS",    id:"mc-meta",  color:"var(--accent)",  val:"3.8x",  valCls:"purple" },
                { cls:"c2", label:"Snap ROAS",    id:"mc-snap",  color:"var(--accent2)", val:"2.4x",  valCls:"green"  },
                { cls:"c3", label:"Spend Today",  id:"mc-spend", color:"var(--gold)",    val:"14.2K", valCls:"gold"   },
                { cls:"c4", label:"Purchases",    id:"mc-pur",   color:"var(--snap)",    val:"342",   valCls:"snap"   },
              ].map(mc => (
                <div key={mc.id} className={`mf-mc ${mc.cls}`}>
                  <div className="mf-mc-label">{mc.label}</div>
                  <div className={`mf-mc-val ${mc.valCls}`} id={mc.id}>{mc.val}</div>
                  <div className="mf-mc-bars" id={`bars-${mc.id}`} />
                </div>
              ))}
            </div>

            <div className="mf-platforms fade-up d5" style={{marginTop:28}}>
              <span className="mf-plat-label">Connects to</span>
              {["ⓕ","👻","♪","G","📊"].map((icon,i) => (
                <div key={i} className="mf-badge">{icon}</div>
              ))}
              <div className="mf-badge" style={{fontSize:13,fontWeight:700,color:"var(--accent)"}}>س</div>
            </div>
          </div>

          <div className="fade-up d6" style={{fontSize:11,color:"var(--muted)",fontFamily:"'Space Mono',monospace"}}>
            © 2026 MetricsFlo · All data encrypted · Saudi & Egypt
          </div>
        </div>

        {/* ══ RIGHT AUTH ══ */}
        <div className="mf-auth">
          <div className="mf-live-ind">
            <span className="mf-live-dot" />
            LIVE
          </div>

          <div className="fade-up">
            <div className="mf-auth-title">Welcome back</div>
            <div className="mf-auth-sub">Sign in to your MetricsFlo workspace</div>
          </div>

          {error && <div className="mf-error">⚠ {error}</div>}

          <form onSubmit={handleLogin}>
            <div className="mf-field fade-up d1">
              <label>Email address</label>
              <div className="mf-field-wrap">
                <span className="mf-field-icon">✉</span>
                <input type="email" placeholder="you@agency.com" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"/>
              </div>
            </div>

            <div className="mf-field fade-up d2">
              <label>Password</label>
              <div className="mf-field-wrap">
                <span className="mf-field-icon">🔒</span>
                <input type="password" placeholder="••••••••••" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password"/>
              </div>
            </div>

            <div className="mf-field-row fade-up d3">
              <div className="mf-remember" onClick={() => setRemember(!remember)}>
                <div className={`mf-checkbox ${remember ? "checked" : ""}`}>{remember ? "✓" : ""}</div>
                Keep me signed in
              </div>
              <a href="/forgot-password" className="mf-forgot">Forgot password?</a>
            </div>

            <button type="submit" className="mf-btn-primary fade-up d4" disabled={loading}>
              {success ? "✓ Redirecting..." : loading ? "Signing in..." : "Sign in to Dashboard →"}
            </button>
          </form>

          <div className="mf-divider fade-up d5">
            <div className="mf-divider-line" />
            <span className="mf-divider-text">or continue with</span>
            <div className="mf-divider-line" />
          </div>

          <button className="mf-btn-sso fade-up d5" onClick={handleGoogle}>
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div className="mf-signup-row fade-up d6">
            New to MetricsFlo? <a href="/signup">Start free trial →</a>
          </div>

          <div className="mf-trust-row fade-up d6">
            {["SOC 2 Compliant","256-bit Encryption","No credit card"].map(t => (
              <div key={t} className="mf-trust-item">
                <span className="mf-trust-dot" />
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas + live stats scripts */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          const c = document.getElementById('mf-canvas');
          if (!c) return;
          const ctx = c.getContext('2d');
          let W, H, nodes;
          function resize() {
            W = c.width = window.innerWidth;
            H = c.height = window.innerHeight;
            nodes = Array.from({length: Math.floor(W*H/18000)}, () => ({
              x: Math.random()*W, y: Math.random()*H,
              vx: (Math.random()-.5)*.4, vy: (Math.random()-.5)*.4,
              r: Math.random()*2+.5, hue: Math.random()>.6?165:250
            }));
          }
          function draw() {
            ctx.clearRect(0,0,W,H);
            for(const n of nodes){ n.x+=n.vx; n.y+=n.vy; if(n.x<0||n.x>W)n.vx*=-1; if(n.y<0||n.y>H)n.vy*=-1; }
            for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
              const a=nodes[i],b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,d=Math.sqrt(dx*dx+dy*dy);
              if(d<140){ctx.strokeStyle='hsla('+((a.hue+b.hue)/2)+',80%,65%,'+((1-d/140)*.25)+')';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
            }
            for(const n of nodes){ctx.fillStyle='hsla('+n.hue+',80%,70%,.7)';ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fill();}
            requestAnimationFrame(draw);
          }
          window.addEventListener('resize', resize);
          resize(); draw();

          // Live stats
          const stats = [
            {id:'s-roas', base:3.2, range:.4, fmt:v=>v.toFixed(2)+'x'},
            {id:'s-spend',base:142, range:8,  fmt:v=>Math.round(v*1000).toLocaleString()+' SAR'},
            {id:'s-cpa',  base:28.5,range:3,  fmt:v=>'$'+v.toFixed(2)},
            {id:'s-ctr',  base:24.5,range:4,  fmt:v=>v.toFixed(1)+'%'},
          ];
          function tickStats() {
            stats.forEach(s => {
              const el = document.getElementById(s.id);
              if (el) { const tn = el.childNodes[0]; if(tn) tn.textContent = s.fmt(s.base+(Math.random()-.5)*s.range); }
            });
          }
          setTimeout(tickStats, 800);
          setInterval(tickStats, 3000);

          // Mini bars
          [['bars-mc-meta','#6d5cff'],['bars-mc-snap','#00e5c3'],['bars-mc-spend','#f5c842'],['bars-mc-pur','#fffc00']].forEach(([id,color])=>{
            const el=document.getElementById(id); if(!el)return;
            for(let i=0;i<10;i++){const b=document.createElement('div');b.className='mf-bar';b.style.cssText='height:'+(20+Math.random()*80)+'%;background:'+color+';animation-delay:'+(i*.05)+'s';el.appendChild(b);}
          });
          const charts=[{id:'mc-meta',b:3.8,r:.6,f:v=>v.toFixed(1)+'x'},{id:'mc-snap',b:2.4,r:.5,f:v=>v.toFixed(1)+'x'},{id:'mc-spend',b:14.2,r:2,f:v=>v.toFixed(1)+'K'},{id:'mc-pur',b:342,r:30,f:v=>Math.round(v).toString()}];
          function tickCharts(){charts.forEach(c=>{const el=document.getElementById(c.id);if(el)el.textContent=c.f(c.b+(Math.random()-.5)*c.r);});}
          setTimeout(tickCharts,1200); setInterval(tickCharts,4000);
        })();
      `}} />
    </>
  );
}
