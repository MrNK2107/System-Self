// The paywall every ProLock links to (PAYWALL_ROUTE). Purchases go through RevenueCat (lib/purchases.ts); the server
// stays authoritative: after a purchase or restore only the billing status is refetched, and the webhook grants PRO.
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AuthButton, AuthLink, AuthNotice, AuthShell } from "@/components/AuthShell";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api/client";
import { useGameUserId } from "@/hooks/useGameState";
import { useBillingStatusQuery } from "@/hooks/usePro";
import { PRO_LOCK_LABEL } from "@/lib/api/pro";
import {
  FALLBACK_PLANS,
  PRO_FEATURES,
  STORE_ONLY_LINE,
  billingStatusKey,
  fetchBillingStatus,
  pollUntilPro,
  type Plan,
  type PlanId,
} from "@/lib/billing/core";
import { loadOfferings, purchasePlan, restorePurchases, type Offerings } from "@/lib/purchases";

type Store = { state: "loading" } | { state: "unavailable" } | ({ state: "ready" } & Offerings);

export default function PaywallScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const userId = useGameUserId();
  const billing = useBillingStatusQuery().data;
  const [store, setStore] = useState<Store>({ state: "loading" });
  const [selected, setSelected] = useState<PlanId>("annual");
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setStore({ state: "unavailable" });
      return;
    }
    void loadOfferings(userId).then((o) => {
      if (alive) setStore(o.available ? { state: "ready", plans: o.plans, packages: o.packages } : { state: "unavailable" });
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The webhook grants PRO, so after a purchase or restore poll the server (about 29 s) until it says pro.
  const confirm = useCallback(async (lead: string) => {
    if (!mounted.current) return;
    setMessage({ text: lead, tone: "info" });
    const result = await pollUntilPro(
      async () => {
        const status = await fetchBillingStatus(api);
        qc.setQueryData(billingStatusKey(userId), status);
        return status;
      },
      (ms) => new Promise((r) => setTimeout(r, ms)),
      undefined,
      () => !mounted.current,
    );
    if (result === "stopped" || !mounted.current) return;
    await qc.invalidateQueries({ queryKey: billingStatusKey(userId) });
    if (!mounted.current) return;
    setMessage(
      result === "pro"
        ? { text: "Access confirmed. PRO is active.", tone: "info" }
        : { text: "Confirmation is pending. PRO will appear shortly.", tone: "info" },
    );
  }, [qc, userId]);

  const plans: readonly Plan[] = store.state === "ready" ? store.plans : FALLBACK_PLANS;
  const isPro = billing?.tier === "pro";

  const buy = async () => {
    if (store.state !== "ready" || !userId) return;
    setBusy("buy");
    setMessage(null);
    const result = await purchasePlan(userId, store.packages[selected]);
    if (!mounted.current) return;
    if (result === "purchased") {
      await confirm("Purchase received. The System is confirming your access.");
    } else if (result === "failed") {
      setMessage({ text: "The purchase did not complete. You were not charged by the System.", tone: "error" });
    }
    if (mounted.current) setBusy(null);
  };

  const restore = async () => {
    if (!userId) return;
    setBusy("restore");
    setMessage(null);
    const result = await restorePurchases(userId);
    if (!mounted.current) return;
    if (result === "restored") {
      await confirm("Restore complete. The System is confirming your access.");
    } else {
      setMessage({ text: "Nothing could be restored right now.", tone: "error" });
    }
    if (mounted.current) setBusy(null);
  };

  return (
    <AuthShell tag={PRO_LOCK_LABEL} title="SYSTEM // SELF PRO" subtitle="More tools. The same rules." back>
      {isPro ? (
        <AuthNotice tone="info" message="PRO is active on this account." />
      ) : null}

      <View style={[s.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Text style={[s.heading, { color: colors.foreground }]}>WHAT PRO ADDS</Text>
        {PRO_FEATURES.map((f) => (
          <Text key={f} style={[s.feature, { color: colors.mutedForeground }]}>
            {"> "}
            {f}
          </Text>
        ))}
        <Text style={[s.feature, { color: colors.foreground }]}>PRO never changes rank, score, decay or matching fairness.</Text>
      </View>

      <View style={s.plans}>
        {plans.map((p) => {
          const on = p.id === selected;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => setSelected(p.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[s.plan, { borderColor: on ? colors.primary : colors.border, backgroundColor: colors.card }]}
            >
              <Text style={[s.planLabel, { color: on ? colors.primary : colors.mutedForeground }]}>{p.label}</Text>
              <Text style={[s.planPrice, { color: colors.foreground }]}>{p.price}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {store.state === "loading" ? <ActivityIndicator color={colors.primary} /> : null}
      {store.state === "unavailable" ? <AuthNotice tone="info" message={STORE_ONLY_LINE} /> : null}
      {message ? <AuthNotice tone={message.tone} message={message.text} /> : null}

      <AuthButton
        label="UNLOCK PRO"
        onPress={buy}
        loading={busy === "buy"}
        disabled={store.state !== "ready" || isPro || busy !== null}
      />
      <AuthLink label={busy === "restore" ? "RESTORING..." : "RESTORE PURCHASES"} onPress={() => void (busy === null && restore())} />

      <View style={s.legal}>
        <Text accessibilityRole="link" style={[s.legalText, { color: colors.mutedForeground }]} onPress={() => router.push("/legal/terms")}>
          TERMS
        </Text>
        <Text accessibilityRole="link" style={[s.legalText, { color: colors.mutedForeground }]} onPress={() => router.push("/legal/privacy")}>
          PRIVACY
        </Text>
      </View>
      <AuthLink label="BACK" onPress={() => router.back()} />
    </AuthShell>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 4, padding: 16, gap: 8 },
  heading: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  feature: { fontSize: 12, lineHeight: 18 },
  plans: { flexDirection: "row", gap: 10 },
  plan: { flex: 1, borderWidth: 1, borderRadius: 4, padding: 14, gap: 6 },
  planLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  planPrice: { fontSize: 14, fontWeight: "700" },
  legal: { flexDirection: "row", justifyContent: "center", gap: 24 },
  legalText: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
});
