// Full-funnel view of Snapchat rows for the /funnel dashboard.
//
// Each live Snapchat row (campaign, ad squad or ad) becomes a funnel:
// impressions -> swipes -> landing page views -> content viewed ->
// add to basket -> checkout started -> purchase, with the cost of every stage
// and the step rate between stages. Every row is then compared with the
// account's own average for the same range (the "benchmark") to find where it
// breaks and what to do with it.
//
// Pure functions: no I/O, so they are unit-tested in test/funnel-diagnosis.test.mjs.

const num = (v) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round = (v, d = 2) => Number(num(v).toFixed(d));
const rate = (a, b) => (num(b) > 0 ? num(a) / num(b) : null);
const cost = (spend, count) => (num(count) > 0 ? round(num(spend) / num(count)) : null);

export const STAGES = [
  { key: "impressions", label: "ظهور", short: "Impr." },
  { key: "swipes", label: "سوايب", short: "Swipes" },
  { key: "landing_page_views", label: "زيارة صفحة الهبوط", short: "LPV" },
  { key: "view_content", label: "مشاهدة المنتج", short: "Content" },
  { key: "add_to_cart", label: "إضافة للسلة", short: "ATC" },
  { key: "initiate_checkout", label: "بدء الدفع", short: "Checkout" },
  { key: "purchases", label: "شراء", short: "Purchase" }
];

// Step rates and the part of the funnel each one belongs to.
// Snapchat pixel events are not nested: content views and checkouts are often
// counted more than once per visit, and stores with "buy now" skip the
// basket, so checkouts can exceed adds to basket. Mid-funnel stages are
// therefore measured per swipe (people who reached the site), which stays
// comparable between ad sets; only the last step is purchase per checkout.
// from/to are stage keys; area names the thing to fix when the step is weak.
export const STEPS = [
  { key: "ctr", from: "impressions", to: "swipes", area: "creative", label: "CTR (سوايب ÷ ظهور)" },
  { key: "lpv_rate", from: "swipes", to: "landing_page_views", area: "landing", label: "وصول للصفحة (LPV ÷ سوايب)" },
  { key: "atc_rate", from: "swipes", to: "add_to_cart", area: "offer", label: "إضافة للسلة لكل سوايب" },
  { key: "checkout_rate", from: "swipes", to: "initiate_checkout", area: "offer", label: "بدء الدفع لكل سوايب" },
  { key: "purchase_rate", from: "initiate_checkout", to: "purchases", area: "checkout", label: "إتمام الشراء (شراء ÷ بدء الدفع)" }
];

export const AREAS = {
  creative: { label: "الكريتيف", short: "الكريتيف", fix: "جرّب هوك جديد في أول ثانيتين، أو زاوية/عرض مختلف في الإعلان." },
  landing: { label: "صفحة الهبوط", short: "الصفحة", fix: "راجع سرعة الصفحة وإن الرابط بيفتح نفس المنتج اللي في الإعلان." },
  offer: { label: "العرض / المنتج", short: "العرض", fix: "الناس بتشوف ومبتضيفش: راجع السعر، الخصم، الصور، والتقييمات." },
  checkout: { label: "الدفع / الشحن", short: "الدفع", fix: "الناس بتضيف ومبتكملش: راجع رسوم الشحن، طرق الدفع، وخطوات الدفع." }
};

// Build the funnel for one live Snapchat row (or a summary). Landing page
// views come from the Ads Manager columns or extended metrics when present.
export function buildFunnel(row = {}) {
  const am = row.ads_manager || {};
  const ext = row.extended || {};
  const spend = num(row.spend ?? am["Amount spent"]);
  const impressions = num(row.impressions ?? am["Paid impressions"]);
  const swipes = num(row.swipes ?? am["Clicks"]);
  const landing = num(am["Landing Page Views"] ?? ext.landing_page_views);
  // Ads Manager columns always carry the landing column (0 is a measured
  // zero); extended metrics omit zeros, so there a missing key means unknown.
  const landingMeasured = "Landing Page Views" in am || "landing_page_views" in ext;
  const counts = {
    impressions,
    swipes,
    landing_page_views: landing,
    view_content: num(row.view_content ?? am["Content Viewed"]),
    add_to_cart: num(row.add_to_cart ?? am["Adds To Basket"]),
    initiate_checkout: num(row.initiate_checkout ?? am["Checkouts Started"]),
    purchases: num(row.purchases ?? am["Purchases"])
  };
  const revenue = num(row.revenue ?? am["Purchases Value"]);
  // Hook rate: 2-second video views per impression (Snapchat's "video view"),
  // falling back to the first video quartile.
  const hookViews = num(ext.video_views) || num(row.quartile_1);
  const costs = Object.fromEntries(
    STAGES.map((s) => [s.key, s.key === "impressions" ? cost(spend * 1000, impressions) : cost(spend, counts[s.key])])
  );
  const steps = Object.fromEntries(STEPS.map((s) => [s.key, rate(counts[s.to], counts[s.from])]));
  return {
    spend: round(spend),
    revenue: round(revenue),
    roas: spend > 0 ? round(revenue / spend) : null,
    counts,
    costs, // impressions cost is CPM
    steps,
    hook_rate: rate(hookViews, impressions),
    has_landing: landingMeasured || landing > 0
  };
}

// Sum several funnels' raw counts (for a benchmark built from rows).
export function sumFunnels(funnels = []) {
  const counts = Object.fromEntries(STAGES.map((s) => [s.key, 0]));
  let spend = 0;
  let revenue = 0;
  for (const f of funnels) {
    spend += num(f.spend);
    revenue += num(f.revenue);
    for (const s of STAGES) counts[s.key] += num(f.counts?.[s.key]);
  }
  return buildFunnel({
    spend,
    revenue,
    impressions: counts.impressions,
    swipes: counts.swipes,
    view_content: counts.view_content,
    add_to_cart: counts.add_to_cart,
    initiate_checkout: counts.initiate_checkout,
    purchases: counts.purchases,
    ads_manager: { "Landing Page Views": counts.landing_page_views }
  });
}

// ROAS colour band relative to the target the user picks.
export function roasBand(roas, target = 3) {
  if (roas === null || roas === undefined) return "none";
  if (roas >= target) return "good";
  if (roas >= target * 0.67) return "ok";
  return "bad";
}

// A step is "weak" when it converts below this share of the account average.
const WEAK_STEP = 0.6;
// Cost per ATC / checkout this many times the account average is "far above".
const EXPENSIVE = 2;

// Diagnose one funnel against the benchmark funnel.
// Returns { verdict, verdict_label, tone, break_area, break_step, reasons[], action }.
export function diagnose(funnel, benchmark, { targetRoas = 3, status = null } = {}) {
  const paused = Boolean(status) && status !== "ACTIVE";
  const reasons = [];
  const bCpa = benchmark?.costs?.purchases ?? null;
  const spend = num(funnel.spend);
  const purchases = num(funnel.counts.purchases);

  // Where the funnel breaks first: the first step that is well below average.
  let breakStep = null;
  for (const step of STEPS) {
    if (step.key === "lpv_rate" && (!funnel.has_landing || !(benchmark?.counts?.landing_page_views > 0))) continue;
    const mine = funnel.steps[step.key];
    const avg = benchmark?.steps?.[step.key];
    if (avg === null || avg === undefined || avg <= 0) continue;
    if (num(funnel.counts[step.from]) < minVolume(step.from)) continue; // too few to judge this step
    if (mine === null || mine < avg * WEAK_STEP) {
      breakStep = step;
      reasons.push(`${step.label}: ${pct(mine)} مقابل متوسط الحساب ${pct(avg)}`);
      break;
    }
  }
  // Hook rate counts as a creative break too, for video ads only: image ads
  // have almost no video views, so a hook rate under 2% means "not a video".
  if (!breakStep && funnel.hook_rate !== null && funnel.hook_rate >= 0.02 && benchmark?.hook_rate && funnel.counts.impressions >= 1000 && funnel.hook_rate < benchmark.hook_rate * WEAK_STEP) {
    // A weak hook on an ad set that already sells above target is a note,
    // not a reason to touch it.
    if (roasBand(funnel.roas, targetRoas) !== "good") breakStep = { key: "hook_rate", area: "creative", label: "Hook rate" };
    reasons.push(`Hook rate: ${pct(funnel.hook_rate)} مقابل ${pct(benchmark.hook_rate)}`);
  }

  const atcCost = funnel.costs.add_to_cart;
  const icCost = funnel.costs.initiate_checkout;
  const bAtc = benchmark?.costs?.add_to_cart;
  const bIc = benchmark?.costs?.initiate_checkout;
  const atcExpensive = atcCost !== null && bAtc ? atcCost > bAtc * EXPENSIVE : false;
  const icExpensive = icCost !== null && bIc ? icCost > bIc * EXPENSIVE : false;
  const noAtcAfterSpend = funnel.counts.add_to_cart === 0 && bAtc && spend > bAtc * EXPENSIVE;
  if (atcExpensive) reasons.push(`تكلفة الإضافة للسلة ${atcCost} = ${times(atcCost, bAtc)} متوسط الحساب (${bAtc})`);
  if (icExpensive) reasons.push(`تكلفة بدء الدفع ${icCost} = ${times(icCost, bIc)} متوسط الحساب (${bIc})`);
  if (noAtcAfterSpend) reasons.push(`صرف ${round(spend)} من غير ولا إضافة للسلة`);

  const roas = funnel.roas;
  const band = roasBand(roas, targetRoas);
  const area = breakStep ? AREAS[breakStep.area] : null;
  let verdict;

  // Not enough spend to judge yet: less than half the account's CPA.
  if (bCpa && spend < bCpa * 0.5 && purchases === 0) {
    verdict = "learning";
  } else if (purchases >= 3 && band === "good" && !breakStep) {
    verdict = "scale";
  } else if ((atcExpensive || icExpensive || noAtcAfterSpend) && band !== "good" && (!bCpa || spend >= bCpa)) {
    verdict = "cut";
  } else if (purchases === 0 && !atcExpensive && !noAtcAfterSpend && (atcCost !== null || funnel.counts.landing_page_views > 0)) {
    verdict = "keep";
  } else if (band === "good") {
    verdict = breakStep ? "fix" : "hold_good";
  } else if (breakStep) {
    verdict = "fix";
  } else if (band === "bad") {
    verdict = bCpa && spend >= bCpa * 2 ? "cut" : "watch";
  } else {
    verdict = "watch";
  }

  const ACTIONS = {
    learning: { label: "بيانات قليلة", tone: "neutral", action: "لسه بدري نحكم: سيبه لحد ما يصرف قد متوسط تكلفة الشراء مرة على الأقل." },
    revive: { label: "كسبان ومتوقف", tone: "good", action: "كان شغال كويس في الفترة دي ومتوقف دلوقتي: فكّر تشغله تاني بنفس الميزانية القديمة." },
    scale: { label: "زوّد الميزانية", tone: "good", action: "الفانل كله قوي: زوّد الميزانية 20% وسيبه 2-3 أيام قبل الزيادة الجاية." },
    hold_good: { label: "كويس، ثبّت", tone: "good", action: "العائد كويس بس الشراء قليل للحكم: ثبّت الميزانية وراقب لحد 3 مشتريات أو أكتر." },
    cut: { label: "وقّف بدري", tone: "bad", action: "التكلفة في نص الفانل أغلى بكتير من الحساب: وقّفه أو قلل الميزانية وانقل الفلوس للي شغالين." },
    keep: { label: "استنى", tone: "ok", action: "أول الفانل رخيص ولسه مفيش شراء: سيبه شوية، الشراء ممكن يتأخر." },
    fix: { label: area ? `صلّح ${area.short}` : "صلّح", tone: band === "good" ? "ok" : "bad", action: area ? area.fix : "راجع المرحلة الضعيفة." },
    watch: { label: "راقب", tone: "ok", action: "مفيش مرحلة واضحة مكسورة والعائد أقل من المستهدف: راقبه يومين وقارن بالمتوسط." }
  };
  if (verdict === "scale" && paused) verdict = "revive";
  const chosen = ACTIONS[verdict];
  if (verdict === "scale" || verdict === "revive") reasons.push(`ROAS ${roas} فوق المستهدف ${targetRoas} و${purchases} مشتريات`);
  return {
    verdict,
    verdict_label: chosen.label,
    tone: chosen.tone,
    action: chosen.action,
    break_area: breakStep ? breakStep.area : null,
    break_area_label: area ? area.label : null,
    break_step: breakStep ? breakStep.key : null,
    roas_band: band,
    reasons
  };
}

function minVolume(stage) {
  return stage === "impressions" ? 1000 : stage === "swipes" ? 50 : 10;
}
function pct(v) {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`;
}
function times(a, b) {
  return `${(num(a) / num(b)).toFixed(1)}×`;
}

// Funnels + diagnoses for a list of rows. The benchmark is the account
// summary when given, otherwise the sum of the rows.
export function analyzeRows(rows = [], { summary = null, targetRoas = 3 } = {}) {
  const funnels = rows.map((r) => buildFunnel(r));
  const benchmark = summary ? buildFunnel(summary) : sumFunnels(funnels);
  const items = rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    status: r.status || null,
    campaign_id: r.campaign_id || null,
    campaign_name: r.campaign_name || null,
    adsquad_id: r.adsquad_id || null,
    adsquad_name: r.adsquad_name || null,
    daily_budget: r.ads_manager?.["Ad set daily budget"] ?? null,
    bid: r.ads_manager?.["Ad set bid"] ?? null,
    goal: r.ads_manager?.["Ad set goal"] ?? null,
    funnel: funnels[i],
    diagnosis: diagnose(funnels[i], benchmark, { targetRoas, status: r.status || null })
  }));
  const counts = items.reduce((acc, it) => {
    acc[it.diagnosis.verdict] = (acc[it.diagnosis.verdict] || 0) + 1;
    return acc;
  }, {});
  return { benchmark, items, verdict_counts: counts };
}
