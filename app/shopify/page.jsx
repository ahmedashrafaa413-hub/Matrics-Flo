"use client";
export default function ShopifyPage() {
  return (
    <main style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:300, gap:16 }}>
      <div style={{ fontSize:40 }}>🛒</div>
      <h1 style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:20, fontWeight:700, color:"var(--text)" }}>Shopify</h1>
      <p style={{ color:"var(--muted)", fontSize:14, textAlign:"center" }}>Connect your Shopify store to import orders, revenue, and products.</p>
      <a href="/connections" style={{ background:"linear-gradient(135deg,var(--primary),#4f46e5)", color:"white", padding:"10px 20px", borderRadius:"var(--radius-md)", fontWeight:700, fontSize:13, textDecoration:"none" }}>Go to Connections →</a>
    </main>
  );
}
