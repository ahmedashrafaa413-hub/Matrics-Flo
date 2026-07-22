export async function apiGet(url, { timeoutMs = 0 } = {}) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response;

  try {
    response = await fetch(url, {
      method: "GET",
      credentials: "include",
      signal: controller?.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The request took too long. Please try a shorter date range.");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `API did not return JSON. URL: ${url}. Response: ${text.slice(0, 200)}`
    );
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error?.message ||
        data?.error ||
        `Request failed: ${response.status}`
    );
  }

  return data;
}

export async function apiPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body || {})
  });

  const text = await response.text();

  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `API did not return JSON. URL: ${url}. Response: ${text.slice(0, 200)}`
    );
  }

  if (!response.ok || data?.success === false) {
    throw new Error(
      data?.error?.message ||
        data?.error ||
        `Request failed: ${response.status}`
    );
  }

  return data;
}
