import type { ReportStatus } from "@/lib/api";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/report-format";

export function StatusBadge({ status }: { status: ReportStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}
      data-testid="status-badge"
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
