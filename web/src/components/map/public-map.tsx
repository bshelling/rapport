"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Marker } from "maplibre-gl";
import { useEffect, useState } from "react";
import { useMap } from "@/components/map/use-map";
import { getMapReports, type MapReport } from "@/lib/api";
import { hasMapTiles, TYPE_COLORS } from "@/lib/map-style";
import { formatDate, STATUS_LABEL } from "@/lib/report-format";

const BASIN_MIN_ZOOM = 15;
const fmtCount = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** City catch basins inside a box (data.nola.gov allows browser requests). */
async function fetchBasins(
  north: number,
  west: number,
  south: number,
  east: number,
) {
  const q = new URLSearchParams({
    $select: "gisid,stname,the_geom",
    $where: `within_box(the_geom, ${north}, ${west}, ${south}, ${east})`,
    $limit: "5000",
  });
  const res = await fetch(`https://data.nola.gov/resource/se4p-ierc.json?${q}`);
  if (!res.ok) throw new Error(`basins ${res.status}`);
  const rows: {
    gisid: string;
    stname?: string;
    the_geom: { coordinates: [number, number] };
  }[] = await res.json();
  return rows.map((r) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: r.the_geom.coordinates },
    properties: { id: r.gisid, street: r.stname ?? "" },
  }));
}

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
  const [showCity, setShowCity] = useState(false);
  const [city, setCity] = useState<MapReport[]>([]);
  const [cityCapped, setCityCapped] = useState(false);
  const [showBasins, setShowBasins] = useState(false);
  const [basinNote, setBasinNote] = useState<string | null>(null);

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

  // Open City 311 requests: thousands exist, so load only what's in view.
  useEffect(() => {
    if (!map || !showCity) {
      setCity([]);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = 0;
    const load = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const b = map.getBounds();
        const gen = ++current;
        getMapReports({
          includeCity: true,
          bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        })
          .then((feed) => {
            if (gen !== current) return; // a newer view is loading
            setCity(feed.city);
            setCityCapped(feed.truncated);
          })
          .catch(() => undefined);
      }, 300);
    };
    load();
    map.on("moveend", load);
    return () => {
      clearTimeout(timer);
      map.off("moveend", load);
    };
  }, [map, showCity]);

  useEffect(() => {
    if (!map || city.length === 0) return;
    const markers: Marker[] = [];
    let cancelled = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled) return;
      for (const r of city) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "block h-2.5 w-2.5 rounded-full border-2 bg-white/80";
        el.style.borderColor = TYPE_COLORS[r.request_type] ?? "#5b3f8c";
        el.setAttribute("aria-label", `NOLA 311 request: ${r.request_reason}`);
        el.dataset.testid = "city-pin";
        const popup = new maplibre.Popup({
          offset: 8,
          closeButton: false,
        }).setHTML(
          `<strong>${escapeHtml(r.request_reason)}</strong><br/>` +
            `NOLA 311 #${escapeHtml(r.id)} · open since ${escapeHtml(formatDate(r.created_at))}`,
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
  }, [map, city]);

  // Catch basins (80k citywide) straight from data.nola.gov, only when zoomed in.
  useEffect(() => {
    if (!map) return;
    const SOURCE = "basins";
    if (!map.getSource(SOURCE)) {
      map.addSource(SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: SOURCE,
        type: "circle",
        source: SOURCE,
        minzoom: BASIN_MIN_ZOOM,
        paint: {
          "circle-radius": 3,
          "circle-color": "#5b5968",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });
    }
    map.setLayoutProperty(
      SOURCE,
      "visibility",
      showBasins ? "visible" : "none",
    );
    if (!showBasins) {
      setBasinNote(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = 0;
    const load = () => {
      clearTimeout(timer);
      if (map.getZoom() < BASIN_MIN_ZOOM) {
        setBasinNote("Zoom in to see catch basins.");
        return;
      }
      timer = setTimeout(async () => {
        const gen = ++current;
        const b = map.getBounds();
        try {
          const features = await fetchBasins(
            b.getNorth(),
            b.getWest(),
            b.getSouth(),
            b.getEast(),
          );
          if (gen !== current) return;
          const source = map.getSource(SOURCE) as
            | import("maplibre-gl").GeoJSONSource
            | undefined;
          source?.setData({ type: "FeatureCollection", features });
          setBasinNote(`${fmtCount(features.length)} catch basins in view`);
        } catch {
          setBasinNote("Couldn't load catch basins right now.");
        }
      }, 300);
    };
    load();
    map.on("moveend", load);
    return () => {
      clearTimeout(timer);
      map.off("moveend", load);
    };
  }, [map, showBasins]);

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
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showBasins}
            onChange={(e) => {
              setShowBasins(e.target.checked);
              if (e.target.checked && map && map.getZoom() < BASIN_MIN_ZOOM) {
                map.easeTo({ zoom: BASIN_MIN_ZOOM });
              }
            }}
            data-testid="toggle-basins"
          />
          Catch basins
          {basinNote && (
            <span className="text-muted" data-testid="basin-note">
              ({basinNote})
            </span>
          )}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showCity}
            onChange={(e) => setShowCity(e.target.checked)}
            data-testid="toggle-city"
          />
          City 311 requests
          {showCity && (
            <span className="text-muted" data-testid="city-count">
              ({city.length}
              {cityCapped ? "+" : ""} in view)
            </span>
          )}
        </label>
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
