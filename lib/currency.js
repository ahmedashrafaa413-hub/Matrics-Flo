export const BASE_CURRENCY = "SAR";

export const EXCHANGE_RATES_TO_SAR = {
  SAR: 1,
  USD: 3.75,
  AED: 1.02,
  EGP: 0.078,
  KWD: 12.2,
  QAR: 1.03,
  BHD: 9.95,
  OMR: 9.74,
  EUR: 4.05,
  GBP: 4.8
};

export function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

export function safeDivide(a, b) {
  const x = safeNumber(a);
  const y = safeNumber(b);

  if (!y) return 0;

  return x / y;
}

export function normalizeCurrency(currency) {
  return String(currency || BASE_CURRENCY).toUpperCase();
}

export function getRateToSAR(currency) {
  const normalized = normalizeCurrency(currency);
  return EXCHANGE_RATES_TO_SAR[normalized] || 1;
}

export function toSAR(amount, currency = BASE_CURRENCY) {
  const value = safeNumber(amount);
  const rate = getRateToSAR(currency);

  return value * rate;
}

export function fromSAR(amount, currency = BASE_CURRENCY) {
  const value = safeNumber(amount);
  const rate = getRateToSAR(currency);

  if (!rate) return value;

  return value / rate;
}

export function formatSAR(value) {
  return `${safeNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} SAR`;
}

export function formatNumber(value) {
  return safeNumber(value).toLocaleString();
}

export function formatROAS(value) {
  return `${safeNumber(value).toFixed(2)}x`;
}
