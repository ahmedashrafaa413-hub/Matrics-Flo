export function assertTrustedMutation(request) {
  const targetOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite === "cross-site" || (origin && origin !== targetOrigin)) {
    const error = new Error("Cross-site mutation request denied");
    error.status = 403;
    throw error;
  }

  return true;
}
