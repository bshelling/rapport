"use client";

import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { mapStyle, NOLA_CENTER, NOLA_MAX_BOUNDS } from "@/lib/map-style";

const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

/** Create a MapLibre map in `container` (browser only; loaded lazily). */
export function useMap(options: Partial<MapOptions> = {}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const initial = useRef(options);

  useEffect(() => {
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      // Bundlers don't emit MapLibre's worker; it's served from /public (see
      // the map:worker script) as an ES module next to its shared chunk.
      if (maplibre.getWorkerUrl() !== WORKER_URL)
        maplibre.setWorkerUrl(WORKER_URL);
      const dark =
        window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      instance = new maplibre.Map({
        container: container.current,
        style: mapStyle(dark),
        center: NOLA_CENTER,
        zoom: 11,
        maxBounds: NOLA_MAX_BOUNDS,
        attributionControl: { compact: true },
        ...initial.current,
      });
      instance.addControl(
        new maplibre.NavigationControl({ showCompass: false }),
        "top-right",
      );
      instance.on("load", () => !cancelled && setMap(instance));
    })();
    return () => {
      cancelled = true;
      instance?.remove();
    };
  }, []);

  return { container, map };
}
