import math

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


def geohash_bounds(code: str) -> tuple[float, float, float, float]:
    """(min_lat, min_lng, max_lat, max_lng) of a geohash cell."""
    lat_rng, lng_rng = [-90.0, 90.0], [-180.0, 180.0]
    even = True
    for ch in code:
        val = _BASE32.index(ch)
        for bit in (16, 8, 4, 2, 1):
            rng = lng_rng if even else lat_rng
            mid = (rng[0] + rng[1]) / 2
            if val & bit:
                rng[0] = mid
            else:
                rng[1] = mid
            even = not even
    return lat_rng[0], lng_rng[0], lat_rng[1], lng_rng[1]


def geohash_neighborhood(lat: float, lng: float, precision: int = 6) -> list[str]:
    """The point's cell plus its 8 neighbors (for "nearby" queries across cell edges)."""
    center = geohash(lat, lng, precision)
    min_lat, min_lng, max_lat, max_lng = geohash_bounds(center)
    dlat, dlng = max_lat - min_lat, max_lng - min_lng
    clat, clng = (min_lat + max_lat) / 2, (min_lng + max_lng) / 2
    cells = {
        geohash(clat + i * dlat, clng + j * dlng, precision) for i in (-1, 0, 1) for j in (-1, 0, 1)
    }
    return sorted(cells)


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle (haversine) distance in meters."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
