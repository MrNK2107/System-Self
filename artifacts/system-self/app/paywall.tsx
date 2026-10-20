// The paywall every ProLock links to (PAYWALL_ROUTE). Purchases go through RevenueCat (lib/purchases.ts); the server
// stays authoritative: after a purchase or restore only the billing status is refetched, and the webhook grants PRO.
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { api } from "@/lib/api/client";
import { useGameUserId } from "@/hooks/useGameState";
import { useBillingStatusQuery } from "@/hooks/usePro";
import {
  FALLBACK_PLANS,
  MANAGE_SUBSCRIPTION_LABEL,
  STORE_ONLY_LINE,
  autoRenewDisclosure,
  billingStatusKey,
  fetchBillingStatus,
  isProStatus,
  manageSubscriptionUrl,
  pollUntilPro,
  type Plan,
  type PlanId,
} from "@/lib/billing/core";
import { loadOfferings, purchasePlan, restorePurchases, type Offerings } from "@/lib/purchases";

type Store = { state: "loading" } | { state: "unavailable" } | ({ state: "ready" } & Offerings);
type IconName = React.ComponentProps<typeof Feather>["name"];

/** What PRO adds, in plain words (the full list is lib/billing/core PRO_FEATURES). */
const BENEFITS: { icon: IconName; line: string }[] = [
  { icon: "plus-square", line: "Up to three bonus quests a day, with no effect on your score." },
  { icon: "message-circle", line: "A System that remembers your logs and quotes your own words back." },
  { icon: "users", line: "Create a clan, send named challenges and see who your rivals are." },
  { icon: "clock", line: "A full year of history, and logging for days older than 48 hours." },
  { icon: "layers", line: "Rank Freeze, voice logging, Shame Mode, priority rival matching and more than three custom stats." },
];

/** The number in a store price string ("₹3,999 / year" -> 3999), or null. */
function priceValue(price: string): number | null {
  const m = /(\d[\d,]*(?:\.\d+)?)/.exec(price);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whole-percent saving of the yearly plan over twelve months of the monthly one (499 x 12 = 5988 vs 3999: 33%). */
function yearlySaving(plans: readonly Plan[]): number | null {
  const monthly = plans.find((p) => p.id === "monthly");
  const annual = plans.find((p) => p.id === "annual");
  const m = monthly ? priceValue(monthly.price) : null;
  const a = annual ? priceValue(annual.price) : null;
  if (m === null || a === null || a >= m * 12) return null;
  return Math.round((1 - a / (m * 12)) * 100);
}

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
  const isPro = isProStatus(billing);
  const manageUrl = manageSubscriptionUrl(Platform.OS);

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

  const saving = yearlySaving(plans);

  return (
    <Screen title="PRO" back>
      <View style={s.hero}>
        <Text style={[type.title, { color: colors.foreground }]} accessibilityRole="header">
          SYSTEM // SELF PRO
        </Text>
        <Text style={[type.body, { color: colors.mutedForeground }]}>More tools. The same rules.</Text>
      </View>

      <View style={s.benefits}>
        {BENEFITS.map((b) => (
          <View key={b.icon} style={s.benefit}>
            <Feather name={b.icon} size={20} color={colors.primary} style={s.benefitIcon} />
            <Text style={[type.body, s.flex, { color: colors.foreground }]}>{b.line}</Text>
          </View>
        ))}
        <Text style={[type.meta, { color: colors.mutedForeground }]}>PRO never changes rank, score, decay or matching fairness.</Text>
      </View>

      {isPro ? (
        <Text style={[type.bodyStrong, { color: colors.success }]} accessibilityLiveRegion="polite">
          PRO is active on this account.
        </Text>
      ) : (
        <>
          <View style={s.plans} accessibilityRole="radiogroup">
            {plans.map((p) => {
              const on = p.id === selected;
              const yearly = p.id === "annual";
              return (
                <View key={p.id} style={[s.planClip, { borderColor: on ? colors.accentFill : colors.border }]}>
                  <Pressable
                    onPress={() => setSelected(p.id)}
                    android_ripple={{ color: "rgba(168,121,255,0.14)" }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${yearly ? "Yearly" : "Monthly"}, ${p.price}${yearly && saving ? `, save ${saving}%` : ""}`}
                    style={[s.plan, { backgroundColor: colors.card }]}
                  >
                    <Feather name={on ? "check-circle" : "circle"} size={20} color={on ? colors.primary : colors.subtle} />
                    <View style={s.flex}>
                      <Text style={[type.bodyStrong, { color: colors.foreground }]}>{yearly ? "Yearly" : "Monthly"}</Text>
                      <Text style={[type.meta, { color: colors.mutedForeground }]}>{p.price}</Text>
                    </View>
                    {yearly && saving ? <Text style={[type.label, { color: colors.success }]}>{`SAVE ${saving}%`}</Text> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>

          {store.state === "unavailable" ? (
            <Text style={[type.meta, s.center, { color: colors.mutedForeground }]}>{STORE_ONLY_LINE}</Text>
          ) : (
            <Button
              label="Unlock PRO"
              block
              onPress={() => void buy()}
              loading={store.state === "loading" || busy === "buy"}
              disabled={store.state !== "ready" || busy !== null}
            />
          )}
        </>
      )}

      {message ? (
        <Text style={[type.body, { color: message.tone === "error" ? colors.destructive : colors.mutedForeground }]} accessibilityLiveRegion="polite">
          {message.text}
        </Text>
      ) : null}

      <View style={s.quiet}>
        <Button
          label={busy === "restore" ? "Restoring" : "Restore purchases"}
          variant="text"
          disabled={busy !== null}
          onPress={() => void restore()}
        />
        {manageUrl ? (
          <Button label={MANAGE_SUBSCRIPTION_LABEL} variant="text" onPress={() => void Linking.openURL(manageUrl).catch(() => undefined)} />
        ) : null}
        <Text style={[type.meta, s.center, { color: colors.subtle }]}>{autoRenewDisclosure(Platform.OS)}</Text>
        <View style={s.legal}>
          <Button label="Terms" variant="text" onPress={() => router.push("/legal/terms")} />
          <Button label="Privacy" variant="text" onPress={() => router.push("/legal/privacy")} />
        </View>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { gap: space.xs },
  benefits: { gap: space.md },
  benefit: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  benefitIcon: { marginTop: 1 },
  flex: { flex: 1 },
  plans: { gap: space.sm },
  planClip: { borderWidth: 1, borderRadius: 4, overflow: "hidden" },
  plan: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  center: { textAlign: "center" },
  quiet: { alignItems: "center", gap: space.xs },
  legal: { flexDirection: "row", justifyContent: "center", gap: space.md },
});
