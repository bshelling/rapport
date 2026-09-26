"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import {
  ApiError,
  type Draft,
  type DuplicateCandidate,
  supportReport,
} from "@/lib/api";
import { formatDate } from "@/lib/report-format";

/** "Someone already reported this": offer a +1 instead of a duplicate report. */
export function DuplicatesPanel({
  draft,
  onSupported,
}: {
  draft: Draft;
  onSupported: (reportId: string) => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matches = (draft.duplicates?.matches ?? []).filter(
    (m) => !dismissed.includes(m.report_id),
  );
  if (matches.length === 0) return null;

  const plusOne = async (m: DuplicateCandidate) => {
    setBusy(m.report_id);
    setError(null);
    try {
      await supportReport(m.report_id, draft.id);
      onSupported(m.report_id);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? String(
              (err.detail as { detail?: string })?.detail ??
                "Couldn't add your +1.",
            )
          : "Couldn't add your +1. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="Possible duplicates"
      aria-live="polite"
      data-testid="duplicates"
      className="mt-4 rounded-2xl border border-gold/50 bg-gold/10 p-4"
    >
      <AnimatePresence initial={false}>
        {matches.slice(0, 2).map((m) => (
          <motion.div
            key={m.report_id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col gap-2 text-sm"
            data-testid="duplicate-match"
          >
            {m.source === "nola311" ? (
              <p>
                <strong>Already reported to NOLA 311</strong>{" "}
                {Math.round(m.distance_m)} m away: {m.request_reason}, request #
                {m.nola311_ticket}, {formatDate(m.created_at)}. Your report
                still helps track it.
              </p>
            ) : m.is_mine ? (
              <p>
                <strong>You already reported this</strong> on{" "}
                {formatDate(m.created_at)} ({Math.round(m.distance_m)} m away).{" "}
                <Link
                  href={`/reports/view/?id=${m.report_id}`}
                  className="underline"
                >
                  View your report
                </Link>
              </p>
            ) : (
              <p>
                <strong>Likely already reported</strong>{" "}
                {Math.round(m.distance_m)} m away: {m.request_reason},{" "}
                {formatDate(m.created_at)}
                {m.supporter_count > 0 &&
                  ` · ${m.supporter_count} neighbor${m.supporter_count === 1 ? "" : "s"} +1`}
                . Adding your +1 helps the City prioritize it.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!m.is_mine && m.source !== "nola311" && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => plusOne(m)}
                  className="rounded-full bg-foreground px-4 py-1.5 font-semibold text-background disabled:opacity-50"
                >
                  {busy === m.report_id ? "Adding…" : "+1 instead"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDismissed((d) => [...d, m.report_id])}
                className="rounded-full border border-border px-4 py-1.5 font-medium"
              >
                {m.is_mine
                  ? "Report a new problem"
                  : m.source === "nola311"
                    ? "Report anyway"
                    : "Not the same"}
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
