import type { ReportDetail, ReportStatus } from "@/lib/api";

export const STATUS_LABEL: Record<ReportStatus, string> = {
  submitted: "Submitted",
  filed_with_311: "Filed with 311",
  in_progress: "In progress",
  resolved: "Resolved",
  closed_duplicate: "Closed (duplicate)",
};

export const STATUS_STYLE: Record<ReportStatus, string> = {
  submitted: "bg-gold/15 text-foreground",
  filed_with_311: "bg-accent/15 text-foreground",
  in_progress: "bg-sky-500/15 text-foreground",
  resolved: "bg-brand/15 text-foreground",
  closed_duplicate: "bg-border text-muted",
};

export const NOLA_311_REQUEST_URL = "https://nola311.org/service-request";
export const NOLA_311_STATUS_URL = "https://nola311.org/service-request-status";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortRef(id: string): string {
  return id.slice(-8);
}

/** Plain-text summary to paste into the NOLA 311 form. */
export function nola311Summary(r: ReportDetail): string {
  const text = r.description_html
    .replace(/<li>/g, "\n- ")
    .replace(/<\/p>|<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const where = r.location.address
    ? `${r.location.address} (${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)})`
    : `${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)}`;
  return [
    `Request type: ${r.request_type}`,
    `Request reason: ${r.request_reason}`,
    `Location: ${where}`,
    "",
    text,
  ].join("\n");
}
