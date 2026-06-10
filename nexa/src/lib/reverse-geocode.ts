import { fetchWithTimeout } from "@/lib/http";

/**
 * Reverse-geocode coordinates via Nominatim (same source as Detect Location).
 * Returns a display-name string, or a coordinate fallback on failure (including
 * a timeout, so a hung geocoder never stalls the caller).
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string> {
  const fallback = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
    );
    if (!res.ok) return fallback;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name?.trim() || fallback;
  } catch {
    return fallback;
  }
}
