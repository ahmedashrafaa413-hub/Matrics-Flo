export async function apiGet(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include"
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || data?.success === false) {
    throw new Error(data?.error?.message || data?.error || "Request failed");
  }

  return data;
}
