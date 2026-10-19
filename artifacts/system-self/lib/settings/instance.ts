import { api } from "../api/client";
import { clearLocalData } from "../api/query";
import { secureTokenStore } from "../api/session";
import { createSettingsActions } from "./actions";

/** The app's settings actions, wired to the real client, session store and local-data wipe. */
export const settingsActions = createSettingsActions({ api, tokens: secureTokenStore, clearLocalData });
