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

// --- Service catalog ---------------------------------------------------------

export type Reason = { name: string; description: string };
export type ServiceType = {
  name: string;
  description: string;
  reasons: Reason[];
};

export const getServiceCatalog = () =>
  request<{ types: ServiceType[] }>("/api/service-catalog").then(
    (r) => r.types,
  );

// --- Drafts ------------------------------------------------------------------

export type Contact = Omit<ProfileInput, "neighborhood">;

export type DraftLocation = {
  lat: number;
  lng: number;
  address?: string | null;
  source: "gps" | "photo" | "manual";
};

export type DraftPhoto = { id: string; key: string; url?: string | null };

export type Draft = {
  id: string;
  step: number;
  request_type: string | null;
  request_reason: string | null;
  contact: Contact | null;
  location: DraftLocation | null;
  description_html: string | null;
  photos: DraftPhoto[];
  created_at: string;
  updated_at: string;
};

export type DraftPatch = Partial<
  Pick<
    Draft,
    | "step"
    | "request_type"
    | "request_reason"
    | "contact"
    | "location"
    | "description_html"
  >
>;

export type PhotoUpload = {
  photo: DraftPhoto;
  upload_url: string;
  fields: Record<string, string>;
  max_bytes: number;
};

export type Report = {
  id: string;
  request_type: string;
  request_reason: string;
  status: string;
  created_at: string;
};

export const createDraft = () =>
  request<Draft>("/api/drafts", { method: "POST", auth: true });

export const getDraft = (id: string) =>
  request<Draft>(`/api/drafts/${id}`, { auth: true });

export const patchDraft = (id: string, body: DraftPatch) =>
  request<Draft>(`/api/drafts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    auth: true,
  });

export const reservePhoto = (id: string) =>
  request<PhotoUpload>(`/api/drafts/${id}/photos`, {
    method: "POST",
    body: JSON.stringify({ content_type: "image/jpeg" }),
    auth: true,
  });

export const deletePhoto = (id: string, photoId: string) =>
  request<Draft>(`/api/drafts/${id}/photos/${photoId}`, {
    method: "DELETE",
    auth: true,
  });

export const submitDraft = (id: string) =>
  request<Report>(`/api/drafts/${id}/submit`, { method: "POST", auth: true });

/** Upload straight to S3 with the presigned POST; S3 enforces type and size. */
export async function uploadToS3(
  upload: PhotoUpload,
  blob: Blob,
): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append("file", blob, "photo.jpg");
  const res = await fetch(upload.upload_url, { method: "POST", body: form });
  if (!res.ok)
    throw new ApiError(res.status, await res.text().catch(() => undefined));
}

// --- Reports -----------------------------------------------------------------

export type ReportStatus =
  | "submitted"
  | "filed_with_311"
  | "in_progress"
  | "resolved"
  | "closed_duplicate";

export type ReportSummary = {
  id: string;
  request_type: string;
  request_reason: string;
  status: ReportStatus;
  address: string | null;
  lat: number;
  lng: number;
  supporter_count: number;
  photo_count: number;
  thumbnail_url: string | null;
  nola311_ticket: string | null;
  created_at: string;
  updated_at: string;
};

export type ReportEvent = {
  status: ReportStatus;
  source: "user" | "nola311" | "ai" | "system";
  note: string | null;
  created_at: string;
};

export type ReportDetail = {
  id: string;
  is_owner: boolean;
  request_type: string;
  request_reason: string;
  status: ReportStatus;
  location: DraftLocation;
  description_html: string;
  photos: { key: string; url: string }[];
  supporter_count: number;
  nola311_ticket: string | null;
  contact: Contact | null;
  events: ReportEvent[];
  created_at: string;
  updated_at: string;
};

export type ReportFilter = "all" | "open" | "resolved";

export const listMyReports = (status: ReportFilter, cursor?: string | null) => {
  const q = new URLSearchParams({ status });
  if (cursor) q.set("cursor", cursor);
  return request<{ reports: ReportSummary[]; next_cursor: string | null }>(
    `/api/reports/mine?${q}`,
    { auth: true },
  );
};

export const getReport = (id: string) =>
  request<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`, {
    auth: true,
  });

export const setTicket = (id: string, nola311_ticket: string) =>
  request<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ nola311_ticket }),
    auth: true,
  });
