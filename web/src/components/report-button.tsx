"use client";

import { useReport } from "@/components/report/report-provider";

export function ReportButton({ className = "" }: { className?: string }) {
  const { openReport } = useReport();
  return (
    <button
      type="button"
      onClick={() => openReport()}
      className={`rounded-full bg-brand px-6 py-3 font-semibold text-background shadow-sm hover:opacity-90 ${className}`}
    >
      Report an issue
    </button>
  );
}
