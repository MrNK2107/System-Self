// Resolves the API origin. EXPO_PUBLIC_API_URL wins; in dev we fall back to the Metro host on port 3001.
export function apiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const Constants = (require("expo-constants") as typeof import("expo-constants")).default;
  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(":")[0];
  if (host) return `http://${host}:3001`;

  throw new Error("API base URL is not configured. Set EXPO_PUBLIC_API_URL (e.g. http://192.168.1.12:3001).");
}
