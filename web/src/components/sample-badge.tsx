/** Marks demo data (scripts/seed-demo.py) so nobody mistakes it for a real report. */
export function SampleBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full border border-dashed border-muted px-2.5 py-0.5 text-xs font-semibold text-muted"
      data-testid="sample-badge"
      title="Sample data for the demo, not a real resident's report"
    >
      Sample
    </span>
  );
}
