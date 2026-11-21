// Turns Snapchat "external_changelogs" entries (Snap Marketing API, Audit
// Logs) into readable change records: what changed, from what to what, by
// whom and when, with budgets and bids in currency instead of micros.
//
// Raw entry shape:
// { id, created_at, updated_at, event_at, name, action, user_id, email,
//   app_id, app_name, entity_id, entity_type,
//   update_value_records: { <field>: { before_value, after_value } } }
// before_value / after_value are JSON-encoded strings.

const MICRO_KEY = /_micro$|_micros$/;

export function categorizeField(field) {
  const f = String(field || "").toLowerCase();
  if (f.includes("budget")) return "budget";
  if (f.includes("bid") || f.includes("roas_value") || f.includes("cost_cap") || f === "auto_bid") return "bid";
  if (f === "status" || f.includes("delivery_status")) return "status";
  if (f.endsWith("_time") || f.includes("schedul")) return "schedule";
  if (f.includes("targeting") || f.includes("placement") || f.includes("audience")) return "targeting";
  if (f.includes("optimization") || f.includes("conversion_window") || f.includes("pixel")) return "optimization";
  if (f.includes("creative")) return "creative";
  if (f === "name") return "name";
  return "other";
}

function decode(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readable(field, value) {
  if (value === null || value === undefined) return null;
  // Keep full micro precision: bids often move by less than a cent.
  if (MICRO_KEY.test(field) && Number.isFinite(Number(value))) return Number((Number(value) / 1e6).toFixed(6));
  // Times arrive as epoch millis.
  if (/_time$/.test(field) && /^\d{12,14}$/.test(String(value))) return new Date(Number(value)).toISOString();
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 600 ? `${text.slice(0, 600)}…` : value;
  }
  return value;
}

export function parseChangeLogEntry(raw) {
  const entry = raw?.changelog || raw || {};
  const records = entry.update_value_records || {};
  const changes = Object.entries(records).map(([field, rec]) => {
    const before = readable(field, decode(rec?.before_value));
    const after = readable(field, decode(rec?.after_value));
    const change = {
      field: field.replace(MICRO_KEY, ""),
      category: categorizeField(field),
      before,
      after
    };
    if (typeof before === "number" && typeof after === "number" && change.category !== "schedule") {
      change.delta = Number((after - before).toFixed(6));
      if (before) change.delta_pct = Number((((after - before) / before) * 100).toFixed(1));
    }
    return change;
  });
  return {
    id: entry.id || null,
    at: entry.event_at || entry.created_at || null,
    action: entry.action || null,
    entity_type: entry.entity_type || null,
    entity_id: entry.entity_id || null,
    entity_name: entry.name || null,
    changed_by: entry.email || entry.user_id || null,
    via: entry.app_name || null,
    categories: [...new Set(changes.map((c) => c.category))],
    changes
  };
}

// Entries inside [start, end), optionally only those touching the given
// categories (CREATED entries have no field changes and are kept unless a
// category filter is set).
export function filterChanges(entries, { start = null, end = null, categories = [] } = {}) {
  const from = start ? Date.parse(start) : -Infinity;
  const to = end ? Date.parse(end) : Infinity;
  const wanted = new Set(categories);
  return entries
    .filter((e) => {
      const t = Date.parse(e.at);
      if (!Number.isFinite(t) || t < from || t >= to) return false;
      if (!wanted.size) return true;
      return e.categories.some((c) => wanted.has(c));
    })
    .map((e) => (wanted.size ? { ...e, changes: e.changes.filter((c) => wanted.has(c.category)) } : e))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

// Short per-entity summary: how many budget / bid changes, and the budget
// and bid before the first and after the last change in the range.
export function summarizeEntityChanges(entries) {
  const asc = [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const pick = (category) => {
    const hits = asc.flatMap((e) => e.changes.filter((c) => c.category === category).map((c) => ({ ...c, at: e.at })));
    if (!hits.length) return null;
    const numeric = hits.filter((h) => typeof h.after === "number");
    return {
      changes: hits.length,
      increases: numeric.filter((h) => h.delta > 0).length,
      decreases: numeric.filter((h) => h.delta < 0).length,
      first_before: numeric[0]?.before ?? null,
      last_after: numeric[numeric.length - 1]?.after ?? null,
      last_change_at: hits[hits.length - 1].at
    };
  };
  return { total_changes: entries.length, budget: pick("budget"), bid: pick("bid"), status: pick("status") };
}
