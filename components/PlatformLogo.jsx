const PLATFORM_ASSETS = {
  ga: { src: "/platforms/google-analytics.svg", label: "Google Analytics" },
  ga4: { src: "/platforms/google-analytics.svg", label: "Google Analytics" },
  "google-analytics": { src: "/platforms/google-analytics.svg", label: "Google Analytics" },
  "google-ads": { src: "/platforms/google-ads.png", label: "Google Ads" },
  meta: { src: "/platforms/meta.png", label: "Meta" },
  salla: { src: "/platforms/salla-mark.svg", label: "Salla" },
  shopify: { src: "/platforms/shopify.png", label: "Shopify" },
  snapchat: { src: "/platforms/snapchat.png", label: "Snapchat" },
  tiktok: { src: "/platforms/tiktok.png", label: "TikTok" }
};

export default function PlatformLogo({ platform, size = 28, className = "", decorative = false }) {
  const asset = PLATFORM_ASSETS[String(platform || "").toLowerCase()];

  if (!asset) {
    return (
      <span
        className={`platform-logo-fallback ${className}`.trim()}
        style={{ width: size, height: size }}
        aria-hidden={decorative ? "true" : undefined}
      >
        {String(platform || "?").slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className={`platform-logo-image ${className}`.trim()}
      src={asset.src}
      width={size}
      height={size}
      alt={decorative ? "" : `${asset.label} logo`}
      aria-hidden={decorative ? "true" : undefined}
      loading="lazy"
      decoding="async"
    />
  );
}
