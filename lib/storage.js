export function getSetting(key, fallback = "") {
  if (typeof window === "undefined") return fallback;

  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function saveSetting(key, value) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
