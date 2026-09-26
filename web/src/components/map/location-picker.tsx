"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Marker } from "maplibre-gl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useMap } from "@/components/map/use-map";
import {
  getPlace,
  type PlaceSuggestion,
  reverseGeocode,
  suggestPlaces,
} from "@/lib/api";
import { inNewOrleans } from "@/lib/geo";

export type PickedLocation = {
  lat: number;
  lng: number;
  source: "gps" | "photo" | "manual";
  address?: string | null;
};

/**
 * Map + address search. Click or drag to place the pin; search picks a place.
 * The pin follows `value` when it changes elsewhere (GPS, photo).
 */
export function LocationPicker({
  value,
  onChange,
  onAddress,
}: {
  value: PickedLocation | null;
  onChange: (loc: PickedLocation) => void;
  onAddress: (address: string) => void;
}) {
  const id = useId();
  const { container, map } = useMap({ zoom: value ? 16 : 11 });
  const marker = useRef<Marker | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const address = useRef(onAddress);
  address.current = onAddress;

  const pick = useCallback((lat: number, lng: number) => {
    if (!inNewOrleans(lat, lng)) {
      setNote("That spot is outside New Orleans.");
      return;
    }
    setNote(null);
    change.current({ lat, lng, source: "manual" });
    reverseGeocode(lat, lng)
      .then((r) => r.address && address.current(r.address))
      .catch(() => undefined);
  }, []);

  // Place or move the pin whenever the location changes.
  const lat = value?.lat;
  const lng = value?.lng;
  useEffect(() => {
    if (!map || lat === undefined || lng === undefined) return;
    let cancelled = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled) return;
      if (!marker.current) {
        marker.current = new maplibre.Marker({
          draggable: true,
          color: "#2f5d50",
        })
          .setLngLat([lng, lat])
          .addTo(map);
        marker.current.getElement().setAttribute("data-testid", "location-pin");
        marker.current.on("dragend", () => {
          const p = marker.current?.getLngLat();
          if (p) pick(p.lat, p.lng);
        });
      } else {
        marker.current.setLngLat([lng, lat]);
      }
      map.easeTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 16),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [map, lat, lng, pick]);

  // Clicking the map places the pin there.
  useEffect(() => {
    if (!map) return;
    const onClick = (e: { lngLat: { lat: number; lng: number } }) =>
      pick(e.lngLat.lat, e.lngLat.lng);
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, pick]);

  // Debounced address search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      suggestPlaces(q)
        .then((s) => {
          setSuggestions(s);
          setOpen(true);
        })
        .catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const choose = async (s: PlaceSuggestion) => {
    setOpen(false);
    setQuery(""); // the chosen address lands in the address field below
    try {
      const place = await getPlace(s.place_id);
      change.current({
        lat: place.lat,
        lng: place.lng,
        source: "manual",
        address: place.address,
      });
      if (place.address) address.current(place.address);
    } catch {
      setNote("We couldn't find that place in New Orleans.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search for an address
        </label>
        <input
          id={`${id}-search`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder="Search an address or intersection"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        {open && suggestions.length > 0 && (
          <ul
            aria-label="Address suggestions"
            className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-background shadow-lg"
          >
            {suggestions.map((s) => (
              <li key={s.place_id}>
                <button
                  type="button"
                  onClick={() => choose(s)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-brand/10"
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        ref={container}
        className="h-56 w-full overflow-hidden rounded-xl border border-border"
        data-testid="location-map"
        role="application"
        aria-label="Map: click to place the pin, or drag it"
      />
      <p className="text-xs text-muted">
        Tap the map or drag the pin to the exact spot.
      </p>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}
