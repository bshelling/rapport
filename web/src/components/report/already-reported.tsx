"use client";

import type { DuplicateCandidate } from "@/lib/api";
import { formatDate } from "@/lib/report-format";

/**
 * Shown when submit finds an open NOLA 311 request for the same problem. Linking
 * files the report against that request (no separate 311 hand-off needed).
 */
export function AlreadyReported({
  matches,
  busy,
  onLink,
  onSubmitNew,
}: {
  matches: DuplicateCandidate[];
  busy: boolean;
  onLink: (ticket: string) => void;
  onSubmitNew: () => void;
}) {
  return (
    <section
      aria-labelledby="already-reported-heading"
      data-testid="already-reported"
      className="mt-6 rounded-2xl border border-gold/50 bg-gold/10 p-4 text-sm"
    >
      <h3 id="already-reported-heading" className="font-semibold">
        NOLA 311 already has an open request for this
      </h3>
      <p className="mt-1 text-muted">
        Link your report to it and Rapport will follow the City&apos;s status
        for you. Only submit a new request if it&apos;s a different problem.
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {matches.map((m) => (
          <li
            key={m.report_id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              <strong>{m.request_reason}</strong>, request #{m.nola311_ticket}
              <span className="block text-muted">
                {Math.round(m.distance_m)} m from your pin · filed{" "}
                {formatDate(m.created_at)}
              </span>
            </span>
            <button
              type="button"
              disabled={busy || !m.nola311_ticket}
              onClick={() => m.nola311_ticket && onLink(m.nola311_ticket)}
              className="rounded-full bg-foreground px-4 py-1.5 font-semibold text-background disabled:opacity-50"
            >
              Link my report to #{m.nola311_ticket}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={onSubmitNew}
        className="mt-3 rounded-full border border-border px-4 py-1.5 font-medium disabled:opacity-50"
      >
        It&apos;s a different problem: submit a new request
      </button>
    </section>
  );
}
