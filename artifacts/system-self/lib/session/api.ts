import {
  PlacesNearbyResponseSchema,
  SavePlaceResponseSchema,
  type KnownPlaceDto,
} from "@workspace/contracts";
import type { ApiClient } from "@/lib/api/client";

/** Saved, OpenStreetMap and learned places around the phone. */
export async function fetchNearbyPlaces(api: ApiClient, lat: number, lng: number): Promise<KnownPlaceDto[]> {
  const res = await api.request("GET", `/api/places/nearby?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`, { schema: PlacesNearbyResponseSchema });
  return res.places;
}

/** Saves the phone's current position as the user's gym, ground or study place. */
export async function savePlace(
  api: ApiClient,
  place: { kind: "gym" | "sports" | "study"; name: string; lat: number; lng: number },
): Promise<KnownPlaceDto> {
  const res = await api.request("POST", "/api/places", { body: { ...place, radiusM: 100 }, schema: SavePlaceResponseSchema });
  return res.place;
}
