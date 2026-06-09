// ─────────────────────────────────────────────
//  MetricsFlo — Creative Scoring Engine
//  Scores every ad 0-100 and gives Kill/Test/Scale/Winner
// ─────────────────────────────────────────────

export function scoreCreative(row) {
  const spend          = Number(row.spend          || 0);
  const impressions    = Number(row.impressions     || 0);
  const clicks         = Number(row.clicks          || 0);
  const purchases      = Number(row.purchases       || 0);
  const purchaseValue  = Number(row.purchase_value  || 0);
  const addToCart      = Number(row.add_to_cart     || 0);
  const ctr            = Number(row.ctr             || 0);
  const cpm            = Number(row.cpm             || 0);
  const frequency      = Number(row.frequency       || 0);
  const hookRate       = Number(row.hook_rate       || 0);
  const holdRate       = Number(row.hold_rate       || 0);
  const completionRate = Number(row.completion_rate || 0);
  const roas           = Number(row.roas            || 0);
  const cpa            = Number(row.cpa             || 0);

  const scores = {};

  // 1. Hook Strength (0-20)
  // Benchmark: hook_rate > 25% = excellent, 15-25 = good, <10 = weak
  if (hookRate >= 30)      scores.hook = 20;
  else if (hookRate >= 25) scores.hook = 17;
  else if (hookRate >= 18) scores.hook = 13;
  else if (hookRate >= 10) scores.hook = 8;
  else if (hookRate > 0)   scores.hook = 4;
  else                     scores.hook = 0; // no video data

  // 2. Hold Rate (0-15)
  // Benchmark: hold_rate > 40% = excellent
  if (holdRate >= 50)      scores.hold = 15;
  else if (holdRate >= 40) scores.hold = 12;
  else if (holdRate >= 28) scores.hold = 8;
  else if (holdRate >= 15) scores.hold = 4;
  else if (holdRate > 0)   scores.hold = 2;
  else                     scores.hold = 0;

  // 3. CTR Quality (0-20)
  // Benchmark: >2% warm, >1% cold
  if (ctr >= 3)      scores.ctr = 20;
  else if (ctr >= 2) scores.ctr = 17;
  else if (ctr >= 1) scores.ctr = 12;
  else if (ctr >= 0.5) scores.ctr = 6;
  else if (ctr > 0)  scores.ctr = 2;
  else               scores.ctr = 0;

  // 4. Conversion Power (0-25)
  // ROAS + purchases signal real buying intent
  if (roas >= 4 && purchases >= 3)       scores.conv = 25;
  else if (roas >= 3)                     scores.conv = 20;
  else if (roas >= 2)                     scores.conv = 15;
  else if (roas >= 1 && purchases > 0)    scores.conv = 10;
  else if (addToCart > 0 && purchases === 0) scores.conv = 5;
  else if (spend > 0 && purchases === 0)  scores.conv = 2;
  else                                    scores.conv = 0;

  // 5. Cost Efficiency (0-15)
  // CPM signal — low CPM = audience not saturated
  if (cpm > 0 && cpm <= 5)        scores.cost = 15;
  else if (cpm <= 10)              scores.cost = 12;
  else if (cpm <= 15)              scores.cost = 8;
  else if (cpm <= 25)              scores.cost = 4;
  else if (cpm > 25)               scores.cost = 1;
  else                             scores.cost = 0;

  // 6. Fatigue Penalty (0 to -20)
  // Frequency > 3.5 = fatigue signal
  if (frequency >= 5)       scores.fatigue = -20;
  else if (frequency >= 4)  scores.fatigue = -14;
  else if (frequency >= 3.5) scores.fatigue = -8;
  else                      scores.fatigue = 0;

  // ── Total score ──
  const raw = Object.values(scores).reduce((s, v) => s + v, 0);
  const total = Math.max(0, Math.min(100, raw));

  // ── Decision ──
  let decision, decisionColor, decisionBg;

  const hasSufficientData = spend >= 20 || impressions >= 500;
  const isVideoAd = hookRate > 0 || holdRate > 0;

  if (!hasSufficientData) {
    decision = "Insufficient Data";
    decisionColor = "#94a3b8";
    decisionBg = "rgba(148,163,184,0.1)";
  } else if (total >= 75 && roas >= 2.5) {
    decision = "Winner 🏆";
    decisionColor = "#f59e0b";
    decisionBg = "rgba(245,158,11,0.12)";
  } else if (total >= 55 && (roas >= 1.5 || purchases >= 2)) {
    decision = "Scale ↑";
    decisionColor = "#06d6a0";
    decisionBg = "rgba(6,214,160,0.1)";
  } else if (total >= 35) {
    decision = "Test";
    decisionColor = "#6366f1";
    decisionBg = "rgba(99,102,241,0.1)";
  } else {
    decision = "Kill ✕";
    decisionColor = "#f43f5e";
    decisionBg = "rgba(244,63,94,0.1)";
  }

  // ── Diagnosis ──
  const issues = [];
  const wins   = [];

  if (hookRate > 0 && hookRate < 15)  issues.push("Hook ضعيف — الـ 3 ثواني الأولى لا تشد الجمهور");
  if (hookRate >= 25)                  wins.push(`Hook قوي ${hookRate.toFixed(1)}%`);
  if (holdRate > 0 && holdRate < 30)  issues.push("Hold Rate منخفض — الجمهور يغادر مبكراً");
  if (holdRate >= 40)                  wins.push(`Hold ممتاز ${holdRate.toFixed(1)}%`);
  if (ctr < 0.5 && impressions > 200) issues.push("CTR أقل من 0.5% — Creative لا يتناسب مع الجمهور");
  if (ctr >= 2)                        wins.push(`CTR قوي ${ctr.toFixed(2)}%`);
  if (frequency >= 3.5)               issues.push(`Frequency ${frequency.toFixed(1)} — Creative Fatigue محتمل`);
  if (roas >= 3)                       wins.push(`ROAS ممتاز ${roas.toFixed(2)}x`);
  if (spend > 50 && purchases === 0)  issues.push("إنفاق بدون شراء — مشكلة في الـ Landing Page أو الـ Offer");
  if (cpm > 20)                        issues.push(`CPM مرتفع $${cpm.toFixed(2)} — جمهور مشبع`);

  const primaryIssue = issues[0] || null;
  const primaryWin   = wins[0]   || null;

  return {
    score: total,
    scores,
    decision,
    decisionColor,
    decisionBg,
    diagnosis: { issues, wins, primaryIssue, primaryWin },
    isVideoAd,
    hasSufficientData
  };
}

// Score a list of rows and rank them
export function rankCreatives(rows, nameKey = "ad_name") {
  return rows
    .map(row => ({
      ...row,
      _name:    row[nameKey] || "Unknown",
      _scoring: scoreCreative(row)
    }))
    .sort((a, b) => b._scoring.score - a._scoring.score);
}

// Summary stats across all scored creatives
export function scoringSummary(rankedRows) {
  const winners  = rankedRows.filter(r => r._scoring.decision.startsWith("Winner"));
  const scalable = rankedRows.filter(r => r._scoring.decision.startsWith("Scale"));
  const kills    = rankedRows.filter(r => r._scoring.decision.startsWith("Kill"));
  const tests    = rankedRows.filter(r => r._scoring.decision.startsWith("Test"));

  return { winners, scalable, kills, tests, total: rankedRows.length };
}
