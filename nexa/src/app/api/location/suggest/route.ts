import { NextRequest } from "next/server";
import { getGoogleMapsApiKey } from "@/lib/config";
import { fetchWithTimeout } from "@/lib/http";
import { successResponse, errorResponse } from "@/lib/api/response";

type NominatimSearchResult = {
  display_name?: string;
  lat?: string;
  lon?: string;
};

type GoogleAutocompleteResponse = {
  predictions?: Array<{
    description?: string;
    place_id?: string;
  }>;
  status?: string;
};

type GooglePlaceDetailsResponse = {
  result?: {
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  };
  status?: string;
};

type LocationSuggestion = {
  displayName: string;
  latitude: number;
  longitude: number;
};

async function fetchGoogleSuggestions(
  query: string,
  apiKey: string,
): Promise<LocationSuggestion[]> {
  const autocompleteParams = new URLSearchParams({
    input: query,
    types: "address",
    key: apiKey,
  });

  let autocompleteResponse: Response;
  try {
    autocompleteResponse = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${autocompleteParams.toString()}`,
      { cache: "no-store" },
    );
  } catch {
    return [];
  }

  if (!autocompleteResponse.ok) {
    return [];
  }

  const autocompleteData =
    (await autocompleteResponse.json()) as GoogleAutocompleteResponse;

  if (
    autocompleteData.status !== "OK" ||
    !autocompleteData.predictions?.length
  ) {
    return [];
  }

  const topPredictions = autocompleteData.predictions.slice(0, 5);

  const details = await Promise.all(
    topPredictions.map(async (prediction) => {
      if (!prediction.place_id) return null;

      const detailParams = new URLSearchParams({
        place_id: prediction.place_id,
        fields: "formatted_address,geometry/location",
        key: apiKey,
      });

      let detailResponse: Response;
      try {
        detailResponse = await fetchWithTimeout(
          `https://maps.googleapis.com/maps/api/place/details/json?${detailParams.toString()}`,
          { cache: "no-store" },
        );
      } catch {
        return null;
      }

      if (!detailResponse.ok) return null;

      const detailData =
        (await detailResponse.json()) as GooglePlaceDetailsResponse;
      if (detailData.status !== "OK") return null;

      const lat = detailData.result?.geometry?.location?.lat;
      const lng = detailData.result?.geometry?.location?.lng;
      const displayName =
        detailData.result?.formatted_address ?? prediction.description ?? "";

      if (
        !displayName ||
        typeof lat !== "number" ||
        !Number.isFinite(lat) ||
        typeof lng !== "number" ||
        !Number.isFinite(lng)
      ) {
        return null;
      }

      return {
        displayName,
        latitude: lat,
        longitude: lng,
      };
    }),
  );

  return details.filter((item): item is LocationSuggestion => item !== null);
}

async function fetchNominatimSuggestions(
  query: string,
): Promise<LocationSuggestion[]> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": "Nexa location suggestions",
        },
        cache: "no-store",
      },
    );
  } catch {
    return [];
  }

  if (!response.ok) return [];

  const data = (await response.json()) as NominatimSearchResult[];
  return data
    .map((item) => ({
      displayName: item.display_name ?? "",
      latitude: Number(item.lat),
      longitude: Number(item.lon),
    }))
    .filter(
      (item) =>
        !!item.displayName &&
        Number.isFinite(item.latitude) &&
        Number.isFinite(item.longitude),
    );
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (query.length < 3) {
      return successResponse({ suggestions: [] });
    }

    const googleApiKey = getGoogleMapsApiKey();
    let suggestions: LocationSuggestion[] = [];

    if (googleApiKey) {
      suggestions = await fetchGoogleSuggestions(query, googleApiKey);
    }

    if (!suggestions.length) {
      suggestions = await fetchNominatimSuggestions(query);
    }

    return successResponse({ suggestions });
  } catch (error) {
    // Surface upstream geocoding failures as an envelope error (500) instead of
    // an empty success: a swallowed `{ suggestions: [] }` is indistinguishable
    // from a legitimately-empty result and hides outages. The client treats a
    // non-2xx the same as an empty list, so the graceful UX for real empties is
    // preserved while genuine failures stay observable.
    console.error("Location suggestion error:", error);
    return errorResponse("Failed to look up location suggestions.", 500);
  }
}
