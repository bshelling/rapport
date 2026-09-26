// In production the site and API share an origin (CloudFront routes /api/*).
// Locally, NEXT_PUBLIC_API_BASE points at the FastAPI dev server.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

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
