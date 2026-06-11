export async function apiGet(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include"
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
