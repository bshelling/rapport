"use client";

import { motion } from "motion/react";
import type { Report } from "@/lib/api";

export function SubmittedReport({
  report,
  onClose,
  onAnother,
}: {
  report: Report;
  onClose: () => void;
  onAnother: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-4 px-6 py-10 text-center"
      data-testid="report-submitted"
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-background"
        aria-hidden
      >
        <svg
          viewBox="0 0 24 24"
          className="h-8 w-8"
          aria-hidden="true"
          role="presentation"
        >
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          />
        </svg>
      </motion.div>
      <p className="text-xl font-semibold">Thanks, your report is in.</p>
      <p className="max-w-sm text-muted">
        {report.request_reason} ({report.request_type})
        <br />
        Reference{" "}
        <span className="font-mono text-foreground">{report.id.slice(-8)}</span>
      </p>
      <p className="max-w-sm text-sm text-muted">
        Next, we&apos;ll help you hand it to NOLA 311 and keep track of its
        status.
      </p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={onAnother}
          className="rounded-full px-4 py-2 font-medium hover:bg-brand/10"
        >
          Report another
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-brand px-6 py-2 font-semibold text-background"
        >
          Done
        </button>
      </div>
    </div>
  );
}
