import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp, type Quest } from "@/context/AppContext";
import { QuestCard } from "@/components/QuestCard";
import { useSystemAI } from "@/hooks/useSystemAI";

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export default function QuestsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, quests, setQuests, completeQuest, refuseQuest, domainScores, getWeakestDomain, logs } = useApp();
  const { generateQuests, loading } = useSystemAI();
  const [refreshing, setRefreshing] = useState(false);
  const [generated, setGenerated] = useState(false);

  const fetchQuests = useCallback(async () => {
    if (!user) return;
    const scores: { BODY: number; MIND: number; WEALTH: number; DISCIPLINE: number } = {
      BODY: domainScores.find(s => s.domain === "BODY")?.score ?? 50,
      MIND: domainScores.find(s => s.domain === "MIND")?.score ?? 50,
      WEALTH: domainScores.find(s => s.domain === "WEALTH")?.score ?? 50,
      DISCIPLINE: domainScores.find(s => s.domain === "DISCIPLINE")?.score ?? 50,
    };
    const recentLogs = logs.slice(-10).map(l => `${l.domain}: ${l.type}`);
    const weakest = getWeakestDomain();
    const generated = await generateQuests({
      username: user.username,
      rank: user.rank,
      domainScores: scores,
      primaryGoal: user.primaryGoal,
      weakestDomain: weakest,
      recentLogs,
    });

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 0);

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    nextWeek.setHours(23, 59, 59, 0);

    const newQuests: Quest[] = generated.map(q => ({
      id: generateId(),
      type: q.type,
      title: q.title,
      description: q.description,
      domain: q.domain,
      status: "active",
      expiresAt: q.type === "daily" ? tomorrow.toISOString() : nextWeek.toISOString(),
      generatedBySystem: true,
    }));

    await setQuests(newQuests);
    setGenerated(true);
  }, [user, domainScores, logs, getWeakestDomain, generateQuests, setQuests]);

  useEffect(() => {
    if (!generated && quests.length === 0 && user) {
      fetchQuests();
    } else {
      setGenerated(true);
    }
  }, [user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchQuests();
    setRefreshing(false);
  }, [fetchQuests]);

  const daily = quests.filter(q => q.type === "daily");
  const weekly = quests.filter(q => q.type === "weekly");
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const completedCount = quests.filter(q => q.status === "complete").length;
  const rate = quests.length > 0 ? Math.round((completedCount / quests.length) * 100) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground }]}>QUEST BOARD</Text>
          <View style={[styles.rateBadge, { borderColor: colors.border }]}>
            <Text style={[styles.rateLabel, { color: colors.mutedForeground }]}>COMPLETION</Text>
            <Text style={[styles.rateValue, { color: rate >= 60 ? colors.primary : colors.destructive, fontFamily: "SpaceMono" }]}>
              {rate}%
            </Text>
          </View>
        </View>

        {(loading && !generated) ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
              THE SYSTEM is generating your quests...
            </Text>
          </View>
        ) : (
          <>
            {daily.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DAILY</Text>
                {daily.map(q => (
                  <QuestCard
                    key={q.id}
                    quest={q}
                    onComplete={completeQuest}
                    onRefuse={refuseQuest}
                  />
                ))}
              </View>
            )}

            {weekly.length > 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WEEKLY</Text>
                {weekly.map(q => (
                  <QuestCard
                    key={q.id}
                    quest={q}
                    onComplete={completeQuest}
                  />
                ))}
              </View>
            )}

            {quests.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No quests assigned.</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Pull down to generate quests from THE SYSTEM.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "700" as const,
    letterSpacing: 3,
  },
  rateBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 2,
    alignItems: "center",
  },
  rateLabel: {
    fontSize: 8,
    letterSpacing: 2,
    fontWeight: "600" as const,
  },
  rateValue: {
    fontSize: 14,
    fontWeight: "700" as const,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    fontSize: 9,
    letterSpacing: 3,
    fontWeight: "600" as const,
    marginBottom: 2,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    fontStyle: "italic",
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
  },
  emptyText: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
});
