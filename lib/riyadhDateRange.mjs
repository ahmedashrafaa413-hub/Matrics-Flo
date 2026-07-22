const TIME_ZONE = "Asia/Riyadh";

function dateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dateString(date) {
  const { year, month, day } = dateParts(date);
  return `${year}-${month}-${day}`;
}

function shiftRiyadhDate(date, days) {
  const { year, month, day } = dateParts(date);
  const anchor = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return dateString(anchor);
}

export function getRiyadhDateRange(preset = "last_30d", now = new Date()) {
  const today = dateString(now);
  const { year, month } = dateParts(now);

  const fromByPreset = {
    today,
    yesterday: shiftRiyadhDate(now, -1),
    last_7d: shiftRiyadhDate(now, -6),
    last_30d: shiftRiyadhDate(now, -29),
    this_month: `${year}-${month}-01`,
    last_90d: shiftRiyadhDate(now, -89),
    maximum: "2000-01-01"
  };

  const normalizedPreset = Object.hasOwn(fromByPreset, preset)
    ? preset
    : "last_30d";
  const from = fromByPreset[normalizedPreset];
  const to = normalizedPreset === "yesterday"
    ? shiftRiyadhDate(now, -1)
    : today;
  const toExclusive = normalizedPreset === "yesterday"
    ? today
    : shiftRiyadhDate(now, 1);

  return {
    from,
    to,
    fromTimestamp: `${from}T00:00:00+03:00`,
    toExclusiveTimestamp: `${toExclusive}T00:00:00+03:00`
  };
}
