"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Marker } from "maplibre-gl";
import { useEffect, useState } from "react";
import { useMap } from "@/components/map/use-map";
import { getMapReports, type MapReport } from "@/lib/api";
import { hasMapTiles, TYPE_COLORS } from "@/lib/map-style";
import { formatDate, STATUS_LABEL } from "@/lib/report-format";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Anonymous live map of reports (no reporter details, rounded locations). */
export function PublicMap() {
  const { container, map } = useMap({ zoom: 11 });
  const [reports, setReports] = useState<MapReport[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getMapReports()
      .then((r) => setReports(r.reports))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!map || !reports) return;
    const markers: Marker[] = [];
    let cancelled = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled) return;
      for (const r of reports) {
        const el = document.createElement("button");
        el.type = "button";
        el.className =
          "block h-3.5 w-3.5 rounded-full border-2 border-white shadow";
        el.style.background = TYPE_COLORS[r.request_type] ?? "#5b3f8c";
        el.setAttribute(
          "aria-label",
          `${r.request_reason}, ${STATUS_LABEL[r.status]}`,
        );
        el.dataset.testid = "map-pin";
        const popup = new maplibre.Popup({
          offset: 10,
          closeButton: false,
        }).setHTML(
          `<strong>${escapeHtml(r.request_reason)}</strong><br/>` +
            `${escapeHtml(STATUS_LABEL[r.status])} · ${escapeHtml(formatDate(r.created_at))}` +
            (r.supporter_count
              ? `<br/>${r.supporter_count} neighbor(s) +1`
              : ""),
        );
        markers.push(
          new maplibre.Marker({ element: el })
            .setLngLat([r.lng, r.lat])
            .setPopup(popup)
            .addTo(map),
        );
      }
    })();
    return () => {
      cancelled = true;
      for (const m of markers) m.remove();
    };
  }, [map, reports]);

  const open = reports?.filter((r) => r.status !== "resolved").length ?? 0;

  return (
    <section aria-labelledby="live-map-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="live-map-heading" className="text-xl font-semibold">
            Live map
          </h2>
          <p className="text-sm text-muted" data-testid="map-summary">
            {failed
              ? "The map couldn't load right now."
              : reports === null
                ? "Loading reports…"
                : `${open} open ${open === 1 ? "report" : "reports"} from residents`}
          </p>
        </div>
        <ul className="flex gap-4 text-sm" aria-label="Legend">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <li key={type} className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              {type}
            </li>
          ))}
        </ul>
      </div>
      <div
        ref={container}
        className="h-80 w-full overflow-hidden rounded-2xl border border-border sm:h-96"
        data-testid="public-map"
        role="application"
        aria-label="Map of reported street and drainage issues"
      />
      {!hasMapTiles && (
        <p className="text-xs text-muted">
          Map imagery isn&apos;t configured in this environment.
        </p>
      )}
    </section>
  );
}
