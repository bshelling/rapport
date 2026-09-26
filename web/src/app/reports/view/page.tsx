"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Nola311Panel } from "@/components/nola311-panel";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { StatusBadge } from "@/components/status-badge";
import { SupportButton } from "@/components/support-button";
import { TicketSuggestion } from "@/components/ticket-suggestion";
import { ApiError, getReport, type ReportDetail } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  STATUS_LABEL,
  shortRef,
} from "@/lib/report-format";

// Static export: the report id travels in the query string (?id=...).
export default function ReportViewPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-8">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ReportView />
      </Suspense>
    </main>
  );
}

function ReportView() {
  const id = useSearchParams().get("id") ?? "";
  const auth = useAuth();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading",
  );

  useEffect(() => {
    if (auth.status !== "signedIn" || !id) return;
    getReport(id)
      .then((r) => {
        setReport(r);
        setState("ready");
      })
      .catch((err) =>
        setState(
          err instanceof ApiError && err.status === 404 ? "missing" : "error",
        ),
      );
  }, [auth.status, id]);

  if (!id) return <p className="text-muted">No report selected.</p>;
  if (auth.status === "signedOut")
    return (
      <SignInPrompt
        message="Sign in to view this report."
        returnTo={`/reports/view/?id=${id}`}
      />
    );
  if (state === "missing")
    return (
      <p>
        We couldn&apos;t find that report.{" "}
        <Link href="/dashboard/" className="underline">
          Back to my reports
        </Link>
      </p>
    );
  if (state === "error")
    return <p className="text-red-600">We couldn&apos;t load this report.</p>;
  if (!report) return <p className="text-muted">Loading…</p>;

  const { location } = report;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;

  return (
    <>
      {report.is_owner && (
        <Link href="/dashboard/" className="text-sm text-muted hover:underline">
          ← My reports
        </Link>
      )}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {report.request_reason}
          </h1>
          <StatusBadge status={report.status} />
        </div>
        <p className="text-muted">
          {report.request_type} · Reported {formatDate(report.created_at)} · Ref{" "}
          {shortRef(report.id)}
        </p>
        <p className="text-sm text-muted" data-testid="supporter-count">
          {report.supporter_count === 0
            ? "No +1s yet"
            : `${report.supporter_count} neighbor${report.supporter_count === 1 ? "" : "s"} +1`}
        </p>
        <SupportButton
          report={report}
          onSupported={(count) =>
            setReport({
              ...report,
              supporter_count: count,
              supported_by_me: true,
            })
          }
        />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-6">
          {report.photos.length > 0 && (
            <section
              className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              aria-label="Photos"
            >
              {report.photos.map((p, i) => (
                <a
                  key={p.key}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* biome-ignore lint/performance/noImgElement: presigned S3 URLs */}
                  <img
                    src={p.url}
                    alt={`Reported issue, view ${i + 1} of ${report.photos.length}`}
                    className="aspect-square w-full rounded-2xl object-cover"
                  />
                </a>
              ))}
            </section>
          )}

          <section aria-labelledby="desc-heading">
            <h2 id="desc-heading" className="mb-2 font-semibold">
              Description
            </h2>
            <div
              className="leading-relaxed [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized server-side (nh3 allowlist: p, br, strong, em, ul, ol, li; no attributes)
              dangerouslySetInnerHTML={{ __html: report.description_html }}
            />
          </section>

          {report.ai && (
            <section
              aria-labelledby="ai-heading"
              className="rounded-2xl border border-accent/30 bg-accent/5 p-4"
              data-testid="ai-assessment"
            >
              <h2 id="ai-heading" className="mb-2 font-semibold">
                <span aria-hidden>✨</span> Photo assessment
              </h2>
              <ul className="flex flex-wrap gap-2 text-sm">
                {report.ai.severity_label && (
                  <li className="rounded-full border border-border bg-background px-3 py-1">
                    Severity: <strong>{report.ai.severity_label}</strong>
                  </li>
                )}
                {(report.ai.safety_hazard ?? 0) >= 0.6 && (
                  <li className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1">
                    Possible safety hazard
                  </li>
                )}
              </ul>
              {report.ai.scene_description && (
                <p className="mt-2 text-sm text-muted">
                  {report.ai.scene_description}
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="loc-heading">
            <h2 id="loc-heading" className="mb-2 font-semibold">
              Location
            </h2>
            <p>{location.address ?? "No address given"}</p>
            <p className="text-sm text-muted">
              {location.lat.toFixed(5)}, {location.lng.toFixed(5)} ·{" "}
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Open in Maps ↗
              </a>
            </p>
          </section>

          {report.contact && (
            <section aria-labelledby="contact-heading">
              <h2 id="contact-heading" className="mb-2 font-semibold">
                Your contact info{" "}
                <span className="text-sm font-normal text-muted">
                  (only you see this)
                </span>
              </h2>
              <p className="text-sm">
                {report.contact.first_name} {report.contact.last_name} ·{" "}
                {report.contact.email}
                {report.contact.phone && ` · ${report.contact.phone}`}
              </p>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <TicketSuggestion report={report} onUpdated={setReport} />
          {report.is_owner && (
            <Nola311Panel report={report} onUpdated={setReport} />
          )}

          <section
            className="rounded-2xl border border-border p-5"
            aria-labelledby="timeline-heading"
          >
            <h2 id="timeline-heading" className="font-semibold">
              Timeline
            </h2>
            <ol
              className="mt-3 flex flex-col gap-4 border-l-2 border-border pl-4"
              data-testid="timeline"
            >
              {[...report.events].reverse().map((e) => (
                <li
                  key={`${e.created_at}-${e.status}-${e.note ?? ""}`}
                  className="relative"
                >
                  <span
                    className="absolute top-1.5 -left-[1.4rem] h-2.5 w-2.5 rounded-full bg-brand"
                    aria-hidden
                  />
                  <p className="text-sm font-medium">
                    {STATUS_LABEL[e.status]}
                  </p>
                  {e.note && <p className="text-sm text-muted">{e.note}</p>}
                  <p className="text-xs text-muted">
                    {formatDateTime(e.created_at)}
                    {e.source === "nola311" && " · Updated by the City"}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
