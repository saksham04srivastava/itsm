const API_ROOT = "/api";

async function request(method, path, body, token, isForm = false) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(API_ROOT + path, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  get: (path, token) => request("GET", path, null, token),
  post: (path, body, token) => request("POST", path, body, token),
  patch: (path, body, token) => request("PATCH", path, body, token),
  delete: (path, token) => request("DELETE", path, null, token),
  postForm: (path, form, token) => request("POST", path, form, token, true),
};
