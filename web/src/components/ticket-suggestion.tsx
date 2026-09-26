"use client";

import { useState } from "react";
import {
  dismissTicketSuggestion,
  type ReportDetail,
  setTicket,
} from "@/lib/api";

/** "We found a matching NOLA 311 request: is it yours?" (from the nightly import). */
export function TicketSuggestion({
  report,
  onUpdated,
}: {
  report: ReportDetail;
  onUpdated: (r: ReportDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const s = report.suggested_ticket;
  if (!report.is_owner || !s || report.nola311_ticket) return null;

  const act = async (fn: () => Promise<ReportDetail>) => {
    setBusy(true);
    setError(false);
    try {
      onUpdated(await fn());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm"
      aria-label="Suggested NOLA 311 request"
      data-testid="ticket-suggestion"
    >
      <p>
        We found a NOLA 311 request that looks like this report:{" "}
        <span className="font-mono font-semibold">#{s.ticket}</span>. Is it the
        one you filed?
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => setTicket(report.id, s.ticket))}
          className="rounded-full bg-foreground px-4 py-1.5 font-semibold text-background disabled:opacity-50"
        >
          Yes, link it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => dismissTicketSuggestion(report.id))}
          className="rounded-full border border-border px-4 py-1.5 font-medium disabled:opacity-50"
        >
          No, not mine
        </button>
      </div>
      {error && (
        <p className="mt-2 text-red-600">
          Something went wrong. Please try again.
        </p>
      )}
    </section>
  );
}
