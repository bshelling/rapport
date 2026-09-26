// Mirrors api/app/geo.py.
export const NOLA_BOUNDS = {
  minLat: 29.86,
  maxLat: 30.2,
  minLng: -90.15,
  maxLng: -89.62,
};

export function inNewOrleans(lat: number, lng: number): boolean {
  const b = NOLA_BOUNDS;
  return (
    lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng
  );
}
