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
    brand: { subtitle: "منصة ذكاء الإعلانات" },
    analytics: {
      title: "مركز تحليلات الأداء", subtitle: "تشخيص موحد للأداء والحملات وجودة البيانات",
      current: "الفترة الحالية", previous: "الفترة السابقة", spend: "الإنفاق", revenue: "الإيرادات",
      purchases: "المشتريات", roas: "العائد على الإنفاق", cpa: "تكلفة الشراء", campaigns: "تحليل الحملات",
      dataQuality: "جودة البيانات", noIssues: "لم يتم اكتشاف مشكلات واضحة في البيانات",
      noCampaigns: "لا توجد حملات متزامنة لهذه الفترة", platform: "المنصة", campaign: "الحملة",
      status: "الحالة", unavailable: "غير متاح", refresh: "تحديث التحليل", loading: "جاري تحليل البيانات…",
      error: "تعذر تحميل التحليلات", lastGenerated: "آخر تحليل"
    }
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
    brand: { subtitle: "Ad Intelligence Platform" },
    analytics: {
      title: "Performance Analytics Center", subtitle: "Unified performance, campaign, and data-quality diagnostics",
      current: "Current period", previous: "Previous period", spend: "Spend", revenue: "Revenue",
      purchases: "Purchases", roas: "ROAS", cpa: "CPA", campaigns: "Campaign analysis",
      dataQuality: "Data quality", noIssues: "No clear data-quality issues detected",
      noCampaigns: "No synchronized campaigns for this period", platform: "Platform", campaign: "Campaign",
      status: "Status", unavailable: "Unavailable", refresh: "Refresh analysis", loading: "Analyzing data…",
      error: "Unable to load analytics", lastGenerated: "Last analysis"
    }
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
