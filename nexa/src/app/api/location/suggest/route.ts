import { NextRequest, NextResponse } from "next/server";

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

  const autocompleteResponse = await fetch(
    `https://maps.googleapis.com/maps/api/place/autocomplete/json?${autocompleteParams.toString()}`,
    { cache: "no-store" },
  );

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

      const detailResponse = await fetch(
        `https://maps.googleapis.com/maps/api/place/details/json?${detailParams.toString()}`,
        { cache: "no-store" },
      );

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
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent": "Nexa location suggestions",
      },
      cache: "no-store",
    },
  );

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
      return NextResponse.json({ suggestions: [] });
    }

    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
    let suggestions: LocationSuggestion[] = [];

    if (googleApiKey) {
      suggestions = await fetchGoogleSuggestions(query, googleApiKey);
    }

    if (!suggestions.length) {
      suggestions = await fetchNominatimSuggestions(query);
    }

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Location suggestion error:", error);
    return NextResponse.json({ suggestions: [] });
  }
}
