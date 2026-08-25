const DEFAULT_GRAPH_VERSION = "v26.0";
const VERSION_PATTERN = /^v\d+\.\d+$/;
const GRAPH_HOST = "graph.facebook.com";

export function getMetaGraphVersion() {
  const configured = String(process.env.META_GRAPH_VERSION || "").trim();
  return VERSION_PATTERN.test(configured) ? configured : DEFAULT_GRAPH_VERSION;
}

export function buildMetaGraphUrl(path, searchParams) {
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const url = new URL(`https://${GRAPH_HOST}/${getMetaGraphVersion()}/${cleanPath}`);

  if (searchParams instanceof URLSearchParams) {
    url.search = searchParams.toString();
  } else if (searchParams && typeof searchParams === "object") {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

function assertTrustedPagingUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== GRAPH_HOST) {
    const error = new Error("Meta returned an untrusted pagination URL");
    error.status = 502;
    throw error;
  }
  return url.toString();
}

async function readMetaResponse(response) {
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(`Meta returned a non-JSON response (HTTP ${response.status})`);
    error.status = 502;
    throw error;
  }

  if (!response.ok || payload?.error) {
    const error = new Error(
      payload?.error?.message || `Meta API request failed (HTTP ${response.status})`
    );
    error.status = response.status >= 400 ? response.status : 400;
    error.metaError = payload?.error || null;
    throw error;
  }

  return payload;
}

export async function fetchMetaCollection({
  url,
  token,
  fetchImpl = fetch,
  maxPages = 100,
  maxItems = 50000
}) {
  if (!url || !token) throw new Error("Meta URL and token are required");

  const rows = [];
  let nextUrl = assertTrustedPagingUrl(url);
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages && rows.length < maxItems) {
    const response = await fetchImpl(nextUrl, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await readMetaResponse(response);
    rows.push(...(Array.isArray(payload?.data) ? payload.data : []));
    pageCount += 1;

    const candidate = payload?.paging?.next;
    nextUrl = candidate ? assertTrustedPagingUrl(candidate) : "";
  }

  if (nextUrl) {
    const error = new Error(
      `Meta pagination exceeded its safety limit (${maxPages} pages / ${maxItems} items)`
    );
    error.status = 422;
    throw error;
  }

  return { data: rows.slice(0, maxItems), pages: pageCount };
}
