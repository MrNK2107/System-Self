import {
  IncomingVouchListSchema,
  PlacesNearbyResponseSchema,
  VouchCreateResponseSchema,
  VouchRespondResponseSchema,
  type IncomingVouch,
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

/** Asks a clanmate, duo partner or mutual follow to vouch for a quest. */
export async function askVouch(api: ApiClient, questId: string, handle: string, note: string): Promise<void> {
  await api.request("POST", `/api/quests/${encodeURIComponent(questId)}/vouch`, {
    body: { handle, note },
    schema: VouchCreateResponseSchema,
  });
}

/** Vouch requests waiting for this user. */
export async function fetchIncomingVouches(api: ApiClient): Promise<IncomingVouch[]> {
  return (await api.request("GET", "/api/vouches/incoming", { schema: IncomingVouchListSchema })).items;
}

/** Confirms or denies a vouch request; resolves to whether the requester's quest completed. */
export async function respondVouch(api: ApiClient, id: string, confirm: boolean): Promise<{ status: string; completed: boolean }> {
  return api.request("POST", `/api/vouches/${encodeURIComponent(id)}/respond`, { body: { confirm }, schema: VouchRespondResponseSchema });
}
