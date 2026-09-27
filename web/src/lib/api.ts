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

export type ReasonOption = {
  request_type: string | null;
  request_reason: string;
  probability: number;
};

export type Triage = {
  status: "pending" | "done" | "error";
  photo_id: string;
  observation?: {
    scene_description: string;
    visible_objects: string[];
    landmarks: string[];
    image_quality:
      | "good"
      | "blurry"
      | "too_dark"
      | "too_far"
      | "not_a_street_scene";
    contains_person_or_plate: boolean;
    suggested_description: string;
  };
  suggested?: ReasonOption;
  alternatives?: ReasonOption[];
  reason_confidence?: number;
  severity?: {
    level: number;
    label: string;
    score: number;
    confidence: number;
  };
  is_actionable?: number;
  safety_hazard?: number;
  matches_selection?: number | null;
  error?: string;
  updated_at: string;
};

export type DuplicateCandidate = {
  report_id: string;
  source: "rapport" | "nola311";
  request_reason: string;
  status: string;
  distance_m: number;
  supporter_count: number;
  nola311_ticket: string | null;
  created_at: string;
  is_mine: boolean;
  probability: number;
};

export type DuplicateCheck = {
  status: "done" | "error";
  checked_for: string;
  matches: DuplicateCandidate[];
  updated_at: string;
};

/** Mirrors api/app/services/duplicates.py check_key. */
export function duplicateCheckKey(
  type: string,
  lat: number,
  lng: number,
): string {
  return `${type}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
}

export type Draft = {
  id: string;
  step: number;
  request_type: string | null;
  request_reason: string | null;
  contact: Contact | null;
  location: DraftLocation | null;
  description_html: string | null;
  photos: DraftPhoto[];
  triage: Triage | null;
  duplicates: DuplicateCheck | null;
  photos_private: boolean;
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

export const confirmUpload = (id: string, photoId: string) =>
  request<Draft>(`/api/drafts/${id}/photos/${photoId}/uploaded`, {
    method: "POST",
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
  sample?: boolean;
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
  sample?: boolean;
  id: string;
  is_owner: boolean;
  request_type: string;
  request_reason: string;
  status: ReportStatus;
  location: DraftLocation;
  description_html: string;
  photos: { key: string; url: string }[];
  photo_public: boolean;
  basin: {
    gisid: string | null;
    street: string | null;
    neighborhood: string | null;
    distance_m: number;
  } | null;
  supported_by_me: boolean;
  ai: {
    suggested_reason?: string;
    reason_confidence?: number;
    severity_level?: number;
    severity_label?: string;
    safety_hazard?: number;
    matches_selection?: number;
    scene_description?: string;
  } | null;
  supporter_count: number;
  nola311_ticket: string | null;
  nola311_verified: boolean;
  suggested_ticket: { ticket: string; probability: number } | null;
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

export const dismissTicketSuggestion = (id: string) =>
  request<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ dismiss_ticket_suggestion: true }),
    auth: true,
  });

export const setTicket = (id: string, nola311_ticket: string) =>
  request<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ nola311_ticket }),
    auth: true,
  });

// --- Places & map --------------------------------------------------------------

export type PlaceSuggestion = { place_id: string; title: string };
export type Place = { lat: number; lng: number; address: string | null };

export const suggestPlaces = (q: string) =>
  request<{ suggestions: PlaceSuggestion[] }>(
    `/api/geo/suggest?q=${encodeURIComponent(q)}`,
    {
      auth: true,
    },
  ).then((r) => r.suggestions);

export const getPlace = (placeId: string) =>
  request<Place>(`/api/geo/place/${encodeURIComponent(placeId)}`, {
    auth: true,
  });

export const reverseGeocode = (lat: number, lng: number) =>
  request<{ address: string | null }>(
    `/api/geo/reverse?lat=${lat}&lng=${lng}`,
    { auth: true },
  );

export type MapReport = {
  sample?: boolean;
  id: string;
  source: "rapport" | "nola311";
  request_type: string;
  request_reason: string;
  status: ReportStatus;
  lat: number;
  lng: number;
  supporter_count: number;
  created_at: string;
};

export type MapFeed = {
  reports: MapReport[];
  city: MapReport[];
  truncated: boolean;
};

export const getMapReports = (
  opts: { includeCity?: boolean; bbox?: number[] } = {},
) => {
  const q = new URLSearchParams();
  if (opts.includeCity) q.set("include_city", "true");
  if (opts.bbox) q.set("bbox", opts.bbox.map((n) => n.toFixed(5)).join(","));
  const qs = q.toString();
  return request<MapFeed>(`/api/map/reports${qs ? `?${qs}` : ""}`);
};

export const supportReport = (reportId: string, draftId?: string) =>
  request<{ report_id: string; supporter_count: number }>(
    `/api/reports/${encodeURIComponent(reportId)}/support`,
    {
      method: "POST",
      body: JSON.stringify({ draft_id: draftId ?? null }),
      auth: true,
    },
  );

// --- Impact stats -----------------------------------------------------------------

export type NeighborhoodStat = {
  neighborhood: string;
  open_requests: number;
  basins: number;
  per_100_basins: number;
};

export type Stats = {
  computed_at: string;
  open_drainage_requests: number;
  open_drainage_by_neighborhood: NeighborhoodStat[];
  total_basins: number;
  median_days_to_close: Record<string, number>;
  potholes_this_month: { reported: number; closed: number };
  francine: {
    drainage_requests: number;
    baseline_requests: number;
    multiplier: number | null;
    catch_basin_not_draining: number;
    window: string;
    baseline_window: string;
  };
  rapport: {
    reports: number;
    supporters: number;
    filed_with_311: number;
    resolved: number;
  };
};

export const getStats = () => request<Stats>("/api/stats");

export type ChatAction = { type: "review_draft"; draft_id: string };

export type ChatReply = {
  reply: string;
  draft_id: string | null;
  actions: ChatAction[];
  off_topic: boolean;
};

export const sendChat = (sessionId: string, message: string) =>
  request<ChatReply>("/api/agent/chat", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, message }),
    auth: true,
  });
