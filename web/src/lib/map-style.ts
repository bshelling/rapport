import type { StyleSpecification } from "maplibre-gl";

const KEY = process.env.NEXT_PUBLIC_MAP_API_KEY ?? "";
const REGION = "us-east-1";

export const NOLA_CENTER: [number, number] = [-90.0715, 29.9511]; // lng, lat
// Keeps the map on Orleans Parish (mirrors api/app/geo.py bounds, with margin).
export const NOLA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-90.35, 29.8],
  [-89.45, 30.25],
];

/** Plain background used when no map key is configured (e.g. local dev). */
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#e9e5dc" },
    },
  ],
};

export const hasMapTiles = Boolean(KEY);

/** Amazon Location Service "Standard" style, restricted API key. */
export function mapStyle(dark = false): string | StyleSpecification {
  if (!KEY) return FALLBACK_STYLE;
  const scheme = dark ? "Dark" : "Light";
  return `https://maps.geo.${REGION}.amazonaws.com/v2/styles/Standard/descriptor?key=${encodeURIComponent(KEY)}&color-scheme=${scheme}`;
}

export const TYPE_COLORS: Record<string, string> = {
  "Roads and Streets": "#b8892d",
  Drainage: "#3b6fb6",
};
