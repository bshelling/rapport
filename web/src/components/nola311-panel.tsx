"use client";

import { useEffect, useState } from "react";
import { ApiError, type ReportDetail, setTicket } from "@/lib/api";
import {
  NOLA_311_REQUEST_URL,
  NOLA_311_STATUS_URL,
  nola311Summary,
} from "@/lib/report-format";

export function Nola311Panel({
  report,
  onUpdated,
}: {
  report: ReportDetail;
  onUpdated: (r: ReportDetail) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(!report.nola311_ticket);
  const [ticket, setTicketValue] = useState(report.nola311_ticket ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The ticket can also arrive from outside this panel (e.g. accepting a
  // suggested City request); show it rather than the empty entry form.
  useEffect(() => {
    if (report.nola311_ticket) {
      setTicketValue(report.nola311_ticket);
      setEditing(false);
    }
  }, [report.nola311_ticket]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(nola311Summary(report));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy. Select the text above instead.");
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onUpdated(await setTicket(report.id, ticket));
      setEditing(false);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 422
          ? "Enter the request number NOLA 311 gave you, like 2026-1322736."
          : "Couldn't save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-border p-5"
      aria-labelledby="nola311-heading"
    >
      <h2 id="nola311-heading" className="font-semibold">
        NOLA 311
      </h2>

      {report.nola311_ticket && !editing ? (
        <div className="mt-2 text-sm">
          <p>
            Filed as request{" "}
            <span className="font-mono font-semibold">
              #{report.nola311_ticket}
            </span>
            .
          </p>
          <p className="mt-1 text-xs text-muted" data-testid="ticket-verified">
            {report.nola311_verified
              ? "✓ Found in the City's 311 data. Status updates come from the City."
              : "We'll look for it in the City's 311 data tonight (it's published daily)."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a
              href={NOLA_311_STATUS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-4 py-1.5 font-medium hover:bg-brand/10"
            >
              Check status on NOLA 311 ↗
            </a>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-2 text-muted underline"
            >
              Change number
            </button>
          </div>
        </div>
      ) : (
        <ol className="mt-3 flex flex-col gap-4 text-sm">
          <li>
            <p className="font-medium">1. Copy your report</p>
            <pre
              className="mt-2 max-h-40 overflow-auto rounded-xl bg-border/40 p-3 font-sans text-xs whitespace-pre-wrap"
              data-testid="nola311-summary"
            >
              {nola311Summary(report)}
            </pre>
            <button
              type="button"
              onClick={copy}
              className="mt-2 rounded-full border border-border px-4 py-1.5 font-medium hover:bg-brand/10"
            >
              {copied ? "Copied ✓" : "Copy summary"}
            </button>
          </li>
          <li>
            <p className="font-medium">2. Submit it to the City</p>
            <p className="mt-1 text-muted">
              Paste it into the NOLA 311 form, or call 3-1-1 / (504) 539-3266.
            </p>
            <a
              href={NOLA_311_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block rounded-full bg-brand px-4 py-1.5 font-semibold text-background"
            >
              Open NOLA 311 ↗
            </a>
          </li>
          <li>
            <form onSubmit={save} noValidate>
              <label htmlFor="nola311-ticket" className="font-medium">
                3. Add the request number they give you
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  id="nola311-ticket"
                  value={ticket}
                  onChange={(e) => setTicketValue(e.target.value)}
                  placeholder="2026-1322736"
                  inputMode="numeric"
                  className="w-44 rounded-xl border border-border bg-background px-3 py-1.5 font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <button
                  type="submit"
                  disabled={saving || !ticket.trim()}
                  className="rounded-full bg-foreground px-4 py-1.5 font-semibold text-background disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                We&apos;ll use it to follow the City&apos;s status updates.
              </p>
            </form>
          </li>
        </ol>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
