"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ReportButton } from "@/components/report-button";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { StatusBadge } from "@/components/status-badge";
import {
  listMyReports,
  type ReportFilter,
  type ReportSummary,
} from "@/lib/api";
import { formatDate, shortRef } from "@/lib/report-format";

const FILTERS: { value: ReportFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

export default function DashboardPage() {
  const auth = useAuth();
  const [filter, setFilter] = useState<ReportFilter>("all");
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  // Each load is tagged; responses for a filter the user has already left are
  // dropped (otherwise a slow "Resolved" reply can overwrite the "All" list).
  const generation = useRef(0);

  const load = useCallback(
    async (f: ReportFilter, after: string | null, gen: number) => {
      const page = await listMyReports(f, after);
      if (gen !== generation.current) return;
      setReports((prev) =>
        after && prev ? [...prev, ...page.reports] : page.reports,
      );
      setCursor(page.next_cursor);
    },
    [],
  );

  useEffect(() => {
    if (auth.status !== "signedIn") return;
    const gen = ++generation.current;
    setReports(null);
    setCursor(null);
    setError(false);
    load(filter, null, gen).catch(
      () => gen === generation.current && setError(true),
    );
  }, [auth.status, filter, load]);

  const more = async () => {
    const gen = generation.current;
    setLoadingMore(true);
    await load(filter, cursor, gen).catch(
      () => gen === generation.current && setError(true),
    );
    setLoadingMore(false);
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My reports</h1>
          <p className="mt-1 text-muted">
            Everything you&apos;ve reported, newest first.
          </p>
        </div>
        {auth.status === "signedIn" && <ReportButton />}
      </div>

      {auth.status === "signedOut" && (
        <SignInPrompt
          message="Sign in to see your reports."
          returnTo="/dashboard/"
        />
      )}

      {auth.status === "signedIn" && (
        <>
          <fieldset className="flex gap-2">
            <legend className="sr-only">Filter reports</legend>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                  filter === f.value
                    ? "bg-foreground text-background"
                    : "border border-border hover:bg-brand/10"
                }`}
              >
                {f.label}
              </button>
            ))}
          </fieldset>

          {error && (
            <p className="text-red-600">
              We couldn&apos;t load your reports. Try again shortly.
            </p>
          )}
          {!error && reports === null && <p className="text-muted">Loading…</p>}
          {reports?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center">
              <p className="font-semibold">
                {filter === "all" ? "No reports yet." : `No ${filter} reports.`}
              </p>
              <p className="mt-1 text-muted">
                Spot a pothole or a clogged catch basin? Report it in a minute.
              </p>
            </div>
          )}

          {reports && reports.length > 0 && (
            <ul className="grid gap-3" aria-label="Reports">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/reports/view/?id=${r.id}`}
                    className="flex gap-4 rounded-2xl border border-border p-4 transition-colors hover:border-brand/50"
                  >
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-border/60">
                      {r.thumbnail_url ? (
                        // biome-ignore lint/performance/noImgElement: presigned S3 URLs
                        <img
                          src={r.thumbnail_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          className="flex h-full items-center justify-center text-2xl"
                          aria-hidden
                        >
                          {r.request_type === "Drainage" ? "💧" : "🛣️"}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{r.request_reason}</p>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted">
                        {r.address ??
                          `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {r.request_type} · {formatDate(r.created_at)} · Ref{" "}
                        {shortRef(r.id)}
                        {r.nola311_ticket && ` · 311 #${r.nola311_ticket}`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {cursor && (
            <button
              type="button"
              onClick={more}
              disabled={loadingMore}
              className="self-center rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-brand/10 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
