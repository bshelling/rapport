"use client";

import { useEffect } from "react";
import { useReport } from "@/components/report/report-provider";

// Deep link (and sign-in return target) that opens the report flow.
export default function ReportPage() {
  const { openReport } = useReport();
  useEffect(() => openReport(), [openReport]);
  return <main className="flex-1" />;
}
