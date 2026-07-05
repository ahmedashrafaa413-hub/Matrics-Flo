import { NextResponse } from "next/server";
import { getSnapchatToken } from "../../../../lib/snapchatToken";
import { getMetaToken } from "../../../../lib/metaToken";

export const dynamic = "force-dynamic";

function safeNum(v) { const n = Number(v||0); return Number.isFinite(n) ? n : 0; }
function safeDivide(a,b) { const x=safeNum(a),y=safeNum(b); return y ? x/y : 0; }
function toSAR(v, cur="USD") {
  const rates = { SAR:1, USD:3.75, AED:1.02, EGP:0.078, EUR:4.05, GBP:4.8 };
  return safeNum(v) * (rates[String(cur).toUpperCase()] || 1);
}

function generateSignals({ metaSummary, snapSummary, sallaSummary, metaCurrency, datePreset }) {
  const signals = [];

  const metaSpendSAR   = toSAR(metaSummary.spend || 0, metaCurrency);
  const metaRevSAR     = toSAR(metaSummary.purchase_value || 0, metaCurrency);
  const snapSpendSAR   = toSAR(snapSummary.spend || 0, "USD");
  const snapRevSAR     = toSAR(snapSummary.revenue || 0, "USD");
  const sallaRevSAR    = safeNum(sallaSummary.total_revenue || sallaSummary.total_sales || 0);
  const sallaOrders    = safeNum(sallaSummary.total_orders || 0);
  const totalSpendSAR  = metaSpendSAR + snapSpendSAR;
  const actualROAS     = safeDivide(sallaRevSAR, totalSpendSAR);
  const metaROAS       = safeNum(metaSummary.roas || 0);
  const snapROAS       = safeNum(snapSummary.roas || 0);
  const metaCTR        = safeNum(metaSummary.ctr || 0);
  const snapCTR        = safeNum(snapSummary.ctr || 0);
  const metaFreq       = safeNum(metaSummary.frequency || 0);
  const metaCPA        = toSAR(metaSummary.cpa || 0, metaCurrency);
  const snapCPA        = toSAR(snapSummary.cpa || 0, "USD");
  const snapHookRate   = safeNum(snapSummary.hook_rate || snapSummary.video_view_rate || 0);
  const metaPurchases  = safeNum(metaSummary.purchases || 0);
  const snapPurchases  = safeNum(snapSummary.purchases || 0);
  const metaATC        = safeNum(metaSummary.add_to_cart || 0);
  const metaIC         = safeNum(metaSummary.initiate_checkout || 0);
  const cartAbandonment = metaATC > 0 ? safeDivide(metaATC - metaPurchases, metaATC) * 100 : 0;

  // 1. Overall ROAS
  if (totalSpendSAR > 0) {
    if (actualROAS >= 3) {
      signals.push({ type:"success", platform:"الكل", metric:"ROAS الفعلي", value:`${actualROAS.toFixed(2)}x`, title:"ROAS ممتاز — فرصة للتوسع", problem:"الحملات تحقق ربحاً قوياً.", cause:`مبيعات سلة ${sallaRevSAR.toFixed(0)} ريال مقابل إنفاق ${totalSpendSAR.toFixed(0)} ريال`, action:"زد الميزانية 15-20% على الحملات الرابحة وكرر الـ creatives الفائزة.", ice:28, priority:1 });
    } else if (actualROAS < 1 && totalSpendSAR > 500) {
      signals.push({ type:"danger", platform:"الكل", metric:"ROAS الفعلي", value:`${actualROAS.toFixed(2)}x`, title:"ROAS أقل من 1 — الإنفاق يتجاوز الإيراد", problem:"الإنفاق الإعلاني يتجاوز مبيعات سلة.", cause:`إنفاق ${totalSpendSAR.toFixed(0)} ريال مقابل مبيعات ${sallaRevSAR.toFixed(0)} ريال فقط`, action:"أوقف الحملات ذات CPA أعلى من AOV. راجع الـ landing page والـ offer فوراً.", ice:30, priority:1 });
    } else if (actualROAS < 2) {
      signals.push({ type:"warning", platform:"الكل", metric:"ROAS الفعلي", value:`${actualROAS.toFixed(2)}x`, title:"ROAS دون المستهدف", problem:"الحملات لم تحقق عائداً كافياً.", cause:"ضعف في الـ creative أو الـ offer أو استهداف الجمهور الخطأ", action:"حسّن أضعف حملة ROAS. اختبر creatives جديدة وقوّ الـ offer.", ice:22, priority:2 });
    }
  }

  // 2. Meta ROAS
  if (metaSpendSAR > 100) {
    if (metaROAS >= 3) {
      signals.push({ type:"success", platform:"Meta", metric:"ROAS", value:`${metaROAS.toFixed(2)}x`, title:"Meta تحقق نتائج قوية", problem:"الحملات تولد مشتريات بكفاءة عالية.", cause:`ROAS ${metaROAS.toFixed(2)}x مع ${metaPurchases} شراء`, action:"وسّع ميزانية الـ ad sets الأعلى ROAS تدريجياً.", ice:25, priority:2 });
    } else if (metaROAS < 1) {
      signals.push({ type:"danger", platform:"Meta", metric:"ROAS", value:`${metaROAS.toFixed(2)}x`, title:"Meta لا تحقق ربحاً", problem:"إنفاق Meta يتجاوز إيرادها.", cause:"ضعف في الـ creative أو الاستهداف أو صفحة الهبوط", action:"أوقف الحملات أقل من 0.8x ROAS. راجع أقوى 3 creatives.", ice:29, priority:1 });
    }
  }

  // 3. CTR signal
  if (metaSpendSAR > 50) {
    if (metaCTR < 0.5) {
      signals.push({ type:"danger", platform:"Meta", metric:"CTR", value:`${metaCTR.toFixed(2)}%`, title:"CTR ضعيف — مشكلة في الـ Creative", problem:"الإعلانات لا تجذب النقرات من الجمهور.", cause:"الـ hook ضعيف أو الـ creative لا يتحدث بلغة الجمهور", action:"اختبر 3 hooks جديدة. ابدأ بالـ pain point مباشرة في أول ثانيتين.", ice:26, priority:1 });
    } else if (metaCTR >= 2) {
      signals.push({ type:"success", platform:"Meta", metric:"CTR", value:`${metaCTR.toFixed(2)}%`, title:"CTR قوي — الـ Creative يعمل", problem:"الجمهور يستجيب بشكل جيد للإعلانات.", cause:`CTR ${metaCTR.toFixed(2)}% يفوق المعدل الطبيعي`, action:"حافظ على هذا الـ creative angle وطوّره في variations جديدة.", ice:20, priority:3 });
    }
  }

  // 4. Frequency / Fatigue
  if (metaFreq >= 3.5 && metaSpendSAR > 100) {
    signals.push({ type:"warning", platform:"Meta", metric:"Frequency", value:`${metaFreq.toFixed(1)}x`, title:"Creative Fatigue — الجمهور شبع", problem:`Frequency ${metaFreq.toFixed(1)} — الجمهور يشاهد نفس الإعلان كثيراً.`, cause:"نفس الـ creative يُعرض على نفس الجمهور بشكل متكرر", action:"أطلق 2-3 creatives جديدة. وسّع الجمهور أو أضف Lookalikes.", ice:24, priority:2 });
  }

  // 5. Cart Abandonment
  if (cartAbandonment > 75 && metaATC > 5) {
    signals.push({ type:"danger", platform:"Meta", metric:"Cart Abandonment", value:`${cartAbandonment.toFixed(0)}%`, title:`${cartAbandonment.toFixed(0)}% يتركون السلة بدون شراء`, problem:"معظم من يضيفون للسلة لا يكملون الشراء.", cause:"تكلفة الشحن، خيارات الدفع، بطء الموقع، أو friction في الـ checkout", action:"راجع صفحة الـ checkout. أضف COD. فعّل retargeting للـ cart abandoners.", ice:27, priority:1 });
  }

  // 6. Snapchat Hook Rate
  if (snapSpendSAR > 100 && snapHookRate > 0) {
    if (snapHookRate < 15) {
      signals.push({ type:"danger", platform:"Snapchat", metric:"Hook Rate", value:`${snapHookRate.toFixed(1)}%`, title:"Hook Rate ضعيف على Snapchat", problem:"الفيديوهات لا توقف المستخدمين عن التمرير.", cause:"الـ hook الأول 3 ثواني ليس قوياً بما يكفي", action:"ابدأ الفيديو بالنتيجة مباشرة أو بسؤال صادم. تجنب الـ intro الطويل.", ice:24, priority:2 });
    } else if (snapHookRate >= 25) {
      signals.push({ type:"success", platform:"Snapchat", metric:"Hook Rate", value:`${snapHookRate.toFixed(1)}%`, title:"Hook Rate ممتاز على Snapchat", problem:"الفيديوهات تجذب انتباه الجمهور بقوة.", cause:`Hook Rate ${snapHookRate.toFixed(1)}% يفوق المعدل`, action:"حلّل هذا الـ creative وكرر نفس الأسلوب في حملات جديدة.", ice:22, priority:3 });
    }
  }

  // 7. Snapchat ROAS
  if (snapSpendSAR > 100) {
    if (snapROAS >= 2.5) {
      signals.push({ type:"success", platform:"Snapchat", metric:"ROAS", value:`${snapROAS.toFixed(2)}x`, title:"Snapchat تحقق عائداً جيداً", problem:"حملات Snapchat تعمل بكفاءة.", cause:`ROAS ${snapROAS.toFixed(2)}x مع ${snapPurchases} شراء`, action:"زد ميزانية Snapchat تدريجياً. اختبر audiences جديدة.", ice:22, priority:3 });
    } else if (snapROAS < 0.8 && snapSpendSAR > 300) {
      signals.push({ type:"danger", platform:"Snapchat", metric:"ROAS", value:`${snapROAS.toFixed(2)}x`, title:"Snapchat لا تغطي تكلفتها", problem:"إنفاق Snapchat لا يتحول لمبيعات.", cause:"ضعف في الـ creative أو الـ audience أو الـ offer", action:"أوقف أضعف حملات Snapchat مؤقتاً. اختبر creative angles مختلفة.", ice:25, priority:2 });
    }
  }

  return signals.sort((a,b) => a.priority - b.priority || b.ice - a.ice);
}

function buildPrompt({ signals, metaSummary, snapSummary, sallaSummary, metaCurrency, datePreset }) {
  const metaSpendSAR  = toSAR(metaSummary.spend || 0, metaCurrency);
  const snapSpendSAR  = toSAR(snapSummary.spend || 0, "USD");
  const sallaRevSAR   = safeNum(sallaSummary.total_revenue || sallaSummary.total_sales || 0);
  const totalSpendSAR = metaSpendSAR + snapSpendSAR;
  const actualROAS    = safeDivide(sallaRevSAR, totalSpendSAR);
  const dateLabel = { today:"اليوم", yesterday:"أمس", last_7d:"آخر 7 أيام", last_30d:"آخر 30 يوم", maximum:"كل الفترة" }[datePreset] || datePreset;

  return `أنت Senior Performance Marketer خبير في السوق السعودي. حلّل بيانات الأداء وأعطِ توصيات دقيقة وقابلة للتنفيذ.

## بيانات الأداء — ${dateLabel}

### Meta Ads
- الإنفاق: ${metaSpendSAR.toFixed(2)} ريال | ROAS: ${safeNum(metaSummary.roas||0).toFixed(2)}x
- المشتريات: ${safeNum(metaSummary.purchases||0)} | CTR: ${safeNum(metaSummary.ctr||0).toFixed(2)}%
- CPA: ${toSAR(metaSummary.cpa||0,metaCurrency).toFixed(2)} ريال | Frequency: ${safeNum(metaSummary.frequency||0).toFixed(2)}
- Add to Cart: ${safeNum(metaSummary.add_to_cart||0)} | Initiate Checkout: ${safeNum(metaSummary.initiate_checkout||0)}

### Snapchat Ads
- الإنفاق: ${snapSpendSAR.toFixed(2)} ريال | ROAS: ${safeNum(snapSummary.roas||0).toFixed(2)}x
- المشتريات: ${safeNum(snapSummary.purchases||0)} | Hook Rate: ${safeNum(snapSummary.hook_rate||snapSummary.video_view_rate||0).toFixed(2)}%
- Impressions: ${safeNum(snapSummary.impressions||0).toLocaleString()}

### سلة (الأرقام الحقيقية)
- المبيعات: ${sallaRevSAR.toFixed(2)} ريال | الطلبات: ${safeNum(sallaSummary.total_orders||0)}
- متوسط قيمة الطلب: ${safeNum(sallaSummary.average_order_value||0).toFixed(2)} ريال

### ROAS الفعلي: ${actualROAS.toFixed(2)}x (إجمالي سلة ÷ إجمالي إنفاق ${totalSpendSAR.toFixed(0)} ريال)

## الإشارات المكتشفة (${signals.length})
${signals.map((s,i) => `${i+1}. [${s.type.toUpperCase()}] ${s.platform} — ${s.title}: ${s.problem}`).join("\n")}

## المطلوب — تحليل عملي بالعربية

**1. خلاصة تنفيذية** (3 جمل — الأهم أولاً بالأرقام)

**2. قرار الأسبوع** — الإجراء الواحد الأهم الآن مع السبب

**3. قرارات المنصات** — Meta و Snapchat: SCALE أو OPTIMIZE أو PAUSE مع سبب محدد

**4. أكبر خسارة في الـ Funnel** — أين تتسرب الفرص؟

**5. فرصة مخفية** — شيء إيجابي في البيانات يمكن الاستغلال أكثر

**6. اختباران مقترحان** — ماذا، كيف، والمتوقع

اكتب بأسلوب مباشر. استخدم الأرقام دائماً. لا نصائح عامة.`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { metaAccountId, snapAccountId, datePreset = "last_7d", metaCurrency = "USD" } = body;
    const baseUrl     = `${new URL(request.url).protocol}//${new URL(request.url).host}`;
    const cookieHeader = request.headers.get("cookie") || "";
    const metaToken   = await getMetaToken(request).catch(() => null) || "";
    const snapToken   = await getSnapchatToken(request).catch(() => null);

    const [metaRes, snapRes, sallaRes] = await Promise.all([
      metaAccountId && metaToken
        ? fetch(`${baseUrl}/api/meta/insights?account_id=${metaAccountId}&level=campaign&date_preset=${datePreset}&token=${metaToken}`, { cache:"no-store", headers:{ Cookie: cookieHeader } }).then(r=>r.json()).catch(()=>({ summary:{} }))
        : Promise.resolve({ summary:{} }),
      snapAccountId && snapToken
        ? fetch(`${baseUrl}/api/snapchat/insights?account_id=${snapAccountId}&level=campaign&date_preset=${datePreset}&snap_token=${encodeURIComponent(snapToken)}`, { cache:"no-store" }).then(r=>r.json()).catch(()=>({ summary:{} }))
        : Promise.resolve({ summary:{} }),
      fetch(`${baseUrl}/api/salla/summary`, { cache:"no-store", headers:{ Cookie: cookieHeader } }).then(r=>r.json()).catch(()=>({})),
    ]);

    const metaSummary  = metaRes?.summary  || {};
    const snapSummary  = snapRes?.summary  || {};
    const sallaSummary = sallaRes || {};

    const signals = generateSignals({ metaSummary, snapSummary, sallaSummary, metaCurrency, datePreset });
    const prompt  = buildPrompt({ signals, metaSummary, snapSummary, sallaSummary, metaCurrency, datePreset });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    let aiText = "تعذّر توليد التحليل.";
    let aiError = null;

    if (!apiKey) {
      aiError = "ANTHROPIC_API_KEY غير موجود في إعدادات Vercel (Environment Variables).";
    } else {
      try {
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        const aiData = await aiRes.json();

        if (!aiRes.ok) {
          aiError = aiData?.error?.message || `Claude API error: ${aiRes.status}`;
        } else {
          aiText = aiData?.content?.[0]?.text || "تعذّر توليد التحليل.";
        }
      } catch (err) {
        aiError = err.message || "فشل الاتصال بـ Claude API";
      }
    }

    return NextResponse.json({
      success: true,
      signals,
      analysis: aiText,
      ai_error: aiError,
      meta:  { spend_sar: toSAR(metaSummary.spend||0,metaCurrency),  roas: metaSummary.roas,  purchases: metaSummary.purchases },
      snap:  { spend_sar: toSAR(snapSummary.spend||0,"USD"),          roas: snapSummary.roas,  purchases: snapSummary.purchases },
      salla: { revenue: sallaSummary.total_revenue||sallaSummary.total_sales||0, orders: sallaSummary.total_orders||0 },
    });
  } catch (err) {
    return NextResponse.json({ success:false, error:err.message }, { status:500 });
  }
}
