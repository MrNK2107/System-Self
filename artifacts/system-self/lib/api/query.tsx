import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient, focusManager, onlineManager, useIsRestoring } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import React, { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { shouldRetryQuery } from "./client";
import { getOutbox } from "./outbox";
import { createLocalDataManager } from "./user-scope";

const DAY_MS = 24 * 60 * 60 * 1000;
export const QUERY_CACHE_KEY = "system_self.rq.v1";
/**
 * Version of the persisted query cache. Bump it whenever a response contract changes shape: a cache written
 * by another version is discarded on restore instead of being handed to the screens.
 */
export const CACHE_VERSION = "p4-5";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { gcTime: DAY_MS, staleTime: 15_000, retry: shouldRetryQuery },
  },
});

const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: QUERY_CACHE_KEY });

const localData = createLocalDataManager({
  storage: AsyncStorage,
  get outbox() {
    return getOutbox();
  },
  queryClient,
  persister,
});

/**
 * Wipe the cached game state and the outbox. Call on explicit sign-out (Task 2 wires the button) BEFORE
 * clearing the session. Do not call on mere session expiry: the same user keeps their queued logs.
 */
export const clearLocalData = localData.clearLocalData;

/** Call after every successful sign-in/register with the user id: wipes local data if the account changed. */
export const handleSignIn = localData.handleSignIn;

// Reachability: unknown (null) counts as online so a slow probe never blocks the app.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => {
    setOnline(state.isConnected !== false && state.isInternetReachable !== false);
  }),
);

function flushOutbox() {
  void getOutbox()
    .flush()
    .catch(() => undefined);
}

/** True while the device has a usable connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

function Lifecycle({ children }: { children: ReactNode }) {
  const restoring = useIsRestoring();

  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      focusManager.setFocused(status === "active");
      if (status === "active") flushOutbox();
    };
    const sub = AppState.addEventListener("change", onChange);
    const unsubOnline = onlineManager.subscribe((online) => {
      if (online) flushOutbox();
    });
    return () => {
      sub.remove();
      unsubOnline();
    };
  }, []);

  useEffect(() => {
    if (!restoring) flushOutbox();
  }, [restoring]);

  return <>{children}</>;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: DAY_MS, buster: CACHE_VERSION }}>
      <Lifecycle>{children}</Lifecycle>
    </PersistQueryClientProvider>
  );
}
