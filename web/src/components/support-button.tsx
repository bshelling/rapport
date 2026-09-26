"use client";

import { useState } from "react";
import { ApiError, type ReportDetail, supportReport } from "@/lib/api";

const OPEN = ["submitted", "filed_with_311", "in_progress"];

/** "I see this too": a neighbor's +1 on someone else's open report. */
export function SupportButton({
  report,
  onSupported,
}: {
  report: ReportDetail;
  onSupported: (count: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (report.is_owner || !OPEN.includes(report.status)) return null;
  if (report.supported_by_me) {
    return (
      <p className="text-sm font-medium text-brand" data-testid="supported">
        ✓ You added your +1
      </p>
    );
  }
  const click = async () => {
    setBusy(true);
    setError(null);
    try {
      onSupported((await supportReport(report.id)).supporter_count);
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
      setBusy(false);
    }
  };
  return (
    <div>
      <button
        type="button"
        onClick={click}
        disabled={busy}
        className="rounded-full bg-accent px-5 py-2 font-semibold text-background disabled:opacity-50"
      >
        {busy ? "Adding…" : "I see this too (+1)"}
      </button>
      {error && (
        <p className="mt-1 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
