"use client";

import { useReport } from "@/components/report/report-provider";

const VARIANTS = {
  primary: "bg-brand text-background shadow-sm hover:opacity-90",
  secondary: "border border-border hover:bg-brand/10",
};

export function ReportButton({
  className = "",
  variant = "primary",
}: {
  className?: string;
  variant?: keyof typeof VARIANTS;
}) {
  const { openReport } = useReport();
  return (
    <button
      type="button"
      onClick={() => openReport()}
      className={`rounded-full px-6 py-3 font-semibold ${VARIANTS[variant]} ${className}`}
    >
      Report an issue
    </button>
  );
}
