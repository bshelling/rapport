_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"

# Generous box around Orleans Parish.
NOLA_BOUNDS = {"min_lat": 29.86, "max_lat": 30.20, "min_lng": -90.15, "max_lng": -89.62}


def in_new_orleans(lat: float, lng: float) -> bool:
    b = NOLA_BOUNDS
    return b["min_lat"] <= lat <= b["max_lat"] and b["min_lng"] <= lng <= b["max_lng"]


def geohash(lat: float, lng: float, precision: int = 6) -> str:
    """Standard geohash; precision 6 cells are ~1.2 km x 0.6 km."""
    lat_rng, lng_rng = [-90.0, 90.0], [-180.0, 180.0]
    out, bits, ch, even = [], 0, 0, True
    while len(out) < precision:
        rng, val = (lng_rng, lng) if even else (lat_rng, lat)
        mid = (rng[0] + rng[1]) / 2
        if val >= mid:
            ch = (ch << 1) | 1
            rng[0] = mid
        else:
            ch <<= 1
            rng[1] = mid
        even = not even
        bits += 1
        if bits == 5:
            out.append(_BASE32[ch])
            bits, ch = 0, 0
    return "".join(out)
