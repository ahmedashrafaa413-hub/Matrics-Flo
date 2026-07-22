export function safeMetric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function divideMetric(numerator, denominator) {
  const bottom = safeMetric(denominator);
  return bottom ? safeMetric(numerator) / bottom : 0;
}

export function buildPerformanceSummary(
  sources,
  { actualSalesAvailable = false, actualSales = 0, actualPurchases = 0 } = {}
) {
  const rows = sources.filter((row) => row.source !== "Total");
  const adRows = rows.filter((row) => row.type === "ads");

  const platformAttributedSales = adRows.reduce(
    (sum, row) => sum + safeMetric(row.sales),
    0
  );
  const platformAttributedPurchases = adRows.reduce(
    (sum, row) => sum + safeMetric(row.purchases),
    0
  );
  const totalAdsSpend = adRows.reduce(
    (sum, row) => sum + safeMetric(row.spend),
    0
  );
  const totalOrganicSales = rows
    .filter((row) => row.type === "organic")
    .reduce((sum, row) => sum + safeMetric(row.sales), 0);
  const totalOtherSales = rows
    .filter((row) => row.type === "other")
    .reduce((sum, row) => sum + safeMetric(row.sales), 0);
  const totalClicks = rows.reduce(
    (sum, row) => sum + safeMetric(row.clicks),
    0
  );

  const fallbackSales = rows.reduce(
    (sum, row) => sum + safeMetric(row.sales),
    0
  );
  const totalSales = actualSalesAvailable
    ? safeMetric(actualSales)
    : fallbackSales;
  const totalPurchases = actualSalesAvailable
    ? safeMetric(actualPurchases)
    : platformAttributedPurchases;

  return {
    currency: "SAR",
    sales_source: actualSalesAvailable ? "salla" : "platform_attribution",
    total_sales: totalSales,
    total_ads_sales: platformAttributedSales,
    platform_attributed_sales: platformAttributedSales,
    total_organic_sales: totalOrganicSales,
    total_other_sales: totalOtherSales,
    total_ads_spend: totalAdsSpend,
    total_purchases: totalPurchases,
    total_clicks: totalClicks,
    actual_roas: divideMetric(totalSales, totalAdsSpend),
    ads_roas: divideMetric(platformAttributedSales, totalAdsSpend),
    cost_per_purchase: divideMetric(totalAdsSpend, totalPurchases)
  };
}
