import type { ExpoConfig } from "expo/config";

type Env = Record<string, string | undefined>;

/**
 * Static base lives in app.json. This layers build-time values from env so no
 * secret or account-specific id is committed (HOLD H-03). With no env set the
 * result is Expo Go friendly: placeholder app id, no extra.eas, no google-services.
 */
export function buildConfig(base: Partial<ExpoConfig>, env: Env): ExpoConfig {
  const appId = env.APP_ID?.trim() || "com.systemself.app";
  const projectId = env.EAS_PROJECT_ID?.trim();
  const googleServices = env.GOOGLE_SERVICES_JSON?.trim();

  const config: ExpoConfig = {
    ...(base as ExpoConfig),
    ios: { ...base.ios, bundleIdentifier: appId },
    android: {
      ...base.android,
      package: appId,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
    },
  };
  if (projectId) {
    config.extra = { ...base.extra, eas: { ...base.extra?.eas, projectId } };
  }
  return config;
}

export default ({ config }: { config: Partial<ExpoConfig> }): ExpoConfig =>
  buildConfig(config, process.env);
