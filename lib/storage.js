export function saveSetting(key, value) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

export function getSetting(key, fallback = null) {
  if (typeof window === "undefined") return fallback;

  const value = localStorage.getItem(key);
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function removeSetting(key) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key);
}
