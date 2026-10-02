"use client";

import { useEffect, useState } from "react";
import {
  DATA_CHANGED,
  getStats,
  type NeighborhoodStat,
  type Stats,
} from "@/lib/api";

const fmt = new Intl.NumberFormat("en-US");

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div
      className="rounded-2xl border border-border p-5"
      data-testid="stat-tile"
    >
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {detail && <p className="mt-1 text-sm text-muted">{detail}</p>}
    </div>
  );
}

/** Horizontal bars, one series. Values at the tips; hover/focus shows the details. */
function NeighborhoodChart({ rows }: { rows: NeighborhoodStat[] }) {
  const [asTable, setAsTable] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.per_100_basins), 1);
  const titleId = "hood-chart-title";

  return (
    <figure
      className="rounded-2xl border border-border p-5"
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <figcaption>
          <h3 id={titleId} className="font-semibold">
            Open City drainage requests per 100 catch basins
          </h3>
          <p className="text-sm text-muted">
            Top 10 neighborhoods (with at least 200 basins)
          </p>
        </figcaption>
        <button
          type="button"
          onClick={() => setAsTable((t) => !t)}
          className="rounded-full border border-border px-3 py-1 text-sm hover:bg-brand/10"
          aria-pressed={asTable}
        >
          {asTable ? "Show as chart" : "Show as table"}
        </button>
      </div>

      {asTable ? (
        <table
          className="mt-4 w-full text-left text-sm"
          data-testid="hood-table"
        >
          <thead className="text-muted">
            <tr>
              <th className="py-1 font-medium">Neighborhood</th>
              <th className="py-1 text-right font-medium">Per 100 basins</th>
              <th className="py-1 text-right font-medium">Open requests</th>
              <th className="py-1 text-right font-medium">Catch basins</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.neighborhood} className="border-t border-border">
                <td className="py-1.5">{r.neighborhood}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.per_100_basins}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {fmt.format(r.open_requests)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {fmt.format(r.basins)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" data-testid="hood-chart">
          {rows.map((r) => {
            const detail = `${r.per_100_basins} per 100 basins: ${fmt.format(r.open_requests)} open requests, ${fmt.format(r.basins)} basins`;
            return (
              <li
                key={r.neighborhood}
                className="relative grid grid-cols-[minmax(7rem,11rem)_1fr] items-center gap-3 text-sm"
              >
                <span className="truncate text-muted" title={r.neighborhood}>
                  {r.neighborhood}
                </span>
                {/* The bar is the hit target: hover, keyboard focus or tap shows the details. */}
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  aria-label={`${r.neighborhood}: ${detail}`}
                  onPointerEnter={() => setActive(r.neighborhood)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(r.neighborhood)}
                  onBlur={() => setActive(null)}
                  onClick={() =>
                    setActive((a) =>
                      a === r.neighborhood ? null : r.neighborhood,
                    )
                  }
                >
                  {/* Track: bar length is a share of this span only, so lengths stay proportional. */}
                  <span className="block min-w-0 flex-1">
                    <span
                      className="block h-5 rounded-r bg-chart-bar"
                      style={{
                        width: `${(r.per_100_basins / max) * 100}%`,
                        minWidth: 4,
                      }}
                    />
                  </span>
                  <span className="w-10 shrink-0 tabular-nums text-foreground">
                    {r.per_100_basins}
                  </span>
                  {active === r.neighborhood && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute right-0 bottom-full z-10 mb-1 block rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg"
                    >
                      <strong className="block text-sm">
                        {r.per_100_basins} per 100 basins
                      </strong>
                      {r.neighborhood} · {fmt.format(r.open_requests)} open ·{" "}
                      {fmt.format(r.basins)} basins
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}

export function Impact() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [missing, setMissing] = useState(false);

  // Rapport's own counts are live: refetch when a report or +1 is filed.
  useEffect(() => {
    const load = () =>
      getStats()
        .then(setStats)
        .catch(() => setMissing(true));
    load();
    window.addEventListener(DATA_CHANGED, load);
    return () => window.removeEventListener(DATA_CHANGED, load);
  }, []);

  if (missing) return null; // before the first nightly run
  if (!stats) {
    return (
      <p className="text-sm text-muted">Loading the latest City numbers…</p>
    );
  }

  const f = stats.francine;
  const basinDays = stats.median_days_to_close["Catch Basin Not Draining"];
  const potholeDays = stats.median_days_to_close.Pothole;
  const r = stats.rapport;

  return (
    <section
      aria-labelledby="impact-heading"
      className="flex flex-col gap-4"
      data-testid="impact"
    >
      <div>
        <h2 id="impact-heading" className="text-xl font-semibold">
          Why catch basins matter
        </h2>
        <p className="mt-1 max-w-2xl text-muted">
          When catch basins clog, streets flood. These numbers come straight
          from the City&apos;s 311 data, updated nightly.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Open City drainage requests"
          value={fmt.format(stats.open_drainage_requests)}
          detail={`across ${fmt.format(stats.total_basins)} catch basins`}
        />
        {basinDays !== undefined && (
          <StatTile
            label="Median days to fix a catch basin that won't drain"
            value={`${Math.round(basinDays)} days`}
            detail={
              potholeDays !== undefined
                ? `Potholes: ${Math.round(potholeDays)} days`
                : undefined
            }
          />
        )}
        {f.multiplier && (
          <StatTile
            label="Drainage requests during Hurricane Francine"
            value={`${f.multiplier}×`}
            detail={`${fmt.format(f.drainage_requests)} in ${f.window} vs ${fmt.format(f.baseline_requests)} a month earlier`}
          />
        )}
        <StatTile
          label="Reports filed on Rapport"
          value={fmt.format(r.reports)}
          detail={`${fmt.format(r.supporters)} neighbor +1s · ${fmt.format(r.filed_with_311)} filed with 311`}
        />
      </div>

      {stats.open_drainage_by_neighborhood.length > 0 && (
        <NeighborhoodChart rows={stats.open_drainage_by_neighborhood} />
      )}

      <p className="text-xs text-muted">
        Source: NOLA 311 and catch basin data from data.nola.gov · updated{" "}
        {new Date(stats.computed_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </p>
    </section>
  );
}
