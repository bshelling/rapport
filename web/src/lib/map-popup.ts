import type { MapReport } from "@/lib/api";
import { formatDate, STATUS_LABEL } from "@/lib/report-format";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Popup for a resident's report on the public map (styled in globals.css). */
export function reportPopupHtml(r: MapReport): string {
  const n = r.supporter_count;
  return (
    `<p class="rp-title">${escapeHtml(r.request_reason)}` +
    (r.sample ? ' <span class="rp-tag">Sample</span>' : "") +
    "</p>" +
    `<p>${escapeHtml(STATUS_LABEL[r.status])} · reported ${escapeHtml(formatDate(r.created_at))}</p>` +
    (n
      ? `<p>${n} ${n === 1 ? "neighbor sees" : "neighbors see"} this too</p>`
      : "")
  );
}

/** Popup for an open City request (NOLA 311 layer). */
export function cityPopupHtml(r: MapReport): string {
  return (
    `<p class="rp-title">${escapeHtml(r.request_reason)}</p>` +
    `<p>NOLA 311 request #${escapeHtml(r.id)}</p>` +
    `<p>Open since ${escapeHtml(formatDate(r.created_at))}</p>`
  );
}
