// Picks which Snapchat campaigns / ad squads / ads to request stats for.
// Large accounts hold hundreds of old entities, and stats are one request
// per entity, so entities that cannot have delivered in the range are
// skipped and the rest are ordered so the likely spenders come first.

const time = (value) => {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : null;
};

// An entity can have delivered in [rangeStart, rangeEnd) unless:
// - it starts on or after the range end, or
// - it ended before the range start, or
// - it is not active and was last changed before the range start (pausing or
//   deleting updates updated_at, so it was already off for the whole range).
export function couldDeliverInRange(entity, rangeStart, rangeEnd) {
  const start = time(entity.start_time);
  const end = time(entity.end_time);
  const updated = time(entity.updated_at);
  if (start !== null && start >= rangeEnd) return false;
  if (end !== null && end < rangeStart) return false;
  if (entity.status !== "ACTIVE" && updated !== null && updated < rangeStart) return false;
  return true;
}

// lookbackMs widens the start for conversion-time reporting: a purchase in
// the range can come from an impression up to the attribution window before
// it, so an entity that stopped delivering then can still have conversions.
export function selectReportableEntities(entities, { startTime, endTime, limit, lookbackMs = 0 }) {
  const rangeStart = Date.parse(startTime) - lookbackMs;
  const rangeEnd = Date.parse(endTime);
  const candidates = entities.filter((e) => couldDeliverInRange(e, rangeStart, rangeEnd));
  candidates.sort((a, b) => {
    const activeDiff = (b.status === "ACTIVE") - (a.status === "ACTIVE");
    if (activeDiff) return activeDiff;
    return (time(b.updated_at) || 0) - (time(a.updated_at) || 0);
  });
  return {
    selected: candidates.slice(0, limit),
    candidates: candidates.length,
    skipped_out_of_range: entities.length - candidates.length
  };
}
