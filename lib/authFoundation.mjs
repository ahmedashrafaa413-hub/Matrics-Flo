export const OAUTH_STATE_MAX_AGE = 10 * 60;

export function getAppUrl(request, env = process.env) {
  const value =
    env.NEXT_PUBLIC_SITE_URL ||
    env.NEXT_PUBLIC_APP_URL ||
    env.APP_URL ||
    new URL(request.url).origin;

  return String(value).replace(/\/+$/, "");
}

export function getRequiredEnv(names, env = process.env) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  return Object.fromEntries(names.map((name) => [name, env[name]]));
}

export function createOAuthState() {
  return crypto.randomUUID();
}

export function oauthStateCookie(provider) {
  return `metricsflo_oauth_${provider}_state`;
}

export function setOAuthStateCookie(response, provider, state) {
  response.cookies.set(oauthStateCookie(provider), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE
  });
  return response;
}

export function verifyOAuthState(request, provider, receivedState) {
  const expected = request.cookies.get(oauthStateCookie(provider))?.value || "";
  return Boolean(expected && receivedState && expected === receivedState);
}

export function clearOAuthStateCookie(response, provider) {
  response.cookies.set(oauthStateCookie(provider), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}
