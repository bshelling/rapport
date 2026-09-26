import { getIdToken } from "@/lib/auth";

// In production the site and API share an origin (CloudFront routes /api/*).
// Locally, NEXT_PUBLIC_API_BASE points at the FastAPI dev server.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth, headers, ...rest } = init;
  const h = new Headers(headers);
  if (rest.body) h.set("Content-Type", "application/json");
  if (auth) {
    const token = await getIdToken();
    if (token) h.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers: h });
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    throw new ApiError(res.status, detail);
  }
  return res.json();
}

export type Health = {
  status: "ok";
  service: string;
  version: string;
  environment: string;
};

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${API_BASE}/api/health`, { signal });
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  return res.json();
}

export type PhoneType = "mobile" | "home";

export type ProfileInput = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  phone_type: PhoneType | null;
  neighborhood: string | null;
};

export type Profile = ProfileInput & {
  sub: string;
  complete: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export const getMe = () => request<Profile>("/api/me", { auth: true });

export const putMe = (body: ProfileInput) =>
  request<Profile>("/api/me", {
    method: "PUT",
    body: JSON.stringify(body),
    auth: true,
  });

export const getNeighborhoods = () =>
  request<{ neighborhoods: string[] }>("/api/neighborhoods").then(
    (r) => r.neighborhoods,
  );
