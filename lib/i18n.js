export const DEFAULT_LOCALE = "ar";
export const SUPPORTED_LOCALES = ["ar", "en"];
export const LOCALE_STORAGE_KEY = "metricsflo_locale";

export const dictionaries = {
  ar: {
    common: {
      arabic: "العربية",
      english: "English",
      language: "اللغة",
      soon: "قريبًا",
      new: "جديد",
      selectWorkspace: "اختر مساحة العمل",
      channels: "المنصات",
      account: "الحساب",
      connected: "المنصات متصلة"
    },
    navigation: {
      analytics: "التحليلات",
      performance: "نظرة عامة على الأداء",
      meta: "إعلانات Meta",
      googleAnalytics: "Google Analytics",
      salla: "سلة",
      snapchat: "إعلانات Snapchat",
      shopify: "Shopify",
      agency: "نظرة الوكالة",
      connections: "ربط المنصات",
      settings: "الإعدادات"
    },
    brand: { subtitle: "منصة ذكاء الإعلانات" }
  },
  en: {
    common: {
      arabic: "العربية",
      english: "English",
      language: "Language",
      soon: "Soon",
      new: "New",
      selectWorkspace: "Select workspace",
      channels: "Channels",
      account: "Account",
      connected: "Platforms Connected"
    },
    navigation: {
      analytics: "Analytics",
      performance: "Performance Overview",
      meta: "Meta Ads",
      googleAnalytics: "Google Analytics",
      salla: "Salla",
      snapchat: "Snapchat Ads",
      shopify: "Shopify",
      agency: "Agency Overview",
      connections: "Connections",
      settings: "Settings"
    },
    brand: { subtitle: "Ad Intelligence Platform" }
  }
};

export function normalizeLocale(value) {
  return SUPPORTED_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

export function getDirection(locale) {
  return normalizeLocale(locale) === "ar" ? "rtl" : "ltr";
}

export function translate(locale, key) {
  const segments = String(key || "").split(".");
  let value = dictionaries[normalizeLocale(locale)];
  for (const segment of segments) value = value?.[segment];
  return typeof value === "string" ? value : key;
}
