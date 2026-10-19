import React, { useMemo, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useApp, ACHIEVEMENT_DEFS, MILESTONE_TITLES, type Domain, type MilestoneTier } from "@/context/AppContext";
import { DomainBar } from "@/components/DomainBar";
import { RankBadge } from "@/components/RankBadge";
import { useQuery } from "@tanstack/react-query";
import { useDeferralsQuery, useGameUserId } from "@/hooks/useGameState";
import { LEDGER_HEADER, ledgerLine } from "@/lib/game/adherence";
import { api } from "@/lib/api/client";
import { completionSummaryKey, debriefKey } from "@/lib/game/keys";
import { fetchCompletionSummary, fetchDebriefToday } from "@/lib/game/messages";
import { SystemMessage } from "@/components/SystemMessage";
import { ScreenStatus } from "@/components/ScreenStatus";
import { StreakCalendar } from "@/components/StreakCalendar";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";

const MILESTONE_TIERS: MilestoneTier[] = [60, 70, 80, 90, 100];

export default function StatsScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    user, domainScores, shadowSelf, logs, quests, trajectory,
    tierProgress,
    achievements, milestones, getShadowPhase,
    loading, loadError, refresh,
  } = useApp();
  const userId = useGameUserId();
  const [showAchievements, setShowAchievements] = useState(false);
  const [showMilestones, setShowMilestones] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const ledgerQ = useDeferralsQuery(30);
  const ledger = ledgerQ.data ?? null;

  const perfQ = useQuery({
    queryKey: completionSummaryKey(userId, 14),
    queryFn: () => fetchCompletionSummary(api, 14),
    enabled: !!userId,
  });
  const perfSummary = perfQ.data ?? null;
  const perfLoading = perfQ.isFetching;
  const perfError = perfQ.isError && !perfSummary ? "Performance feed unavailable." : null;
  const fetchPerformance = () => void perfQ.refetch();

  const debriefQ = useQuery({ queryKey: debriefKey(userId), queryFn: () => fetchDebriefToday(api), enabled: !!userId });
  const debriefData = debriefQ.data;
  const debrief = debriefData?.available ? debriefData.debrief.text : "";
  const debriefOpensAt =
    debriefData && !debriefData.available
      ? new Date(debriefData.availableAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : null;

  const rank = user?.rank ?? "E";
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const completedQuests = quests.filter(q => q.status === "complete").length;
  const totalLogs = logs.length;
  const forbiddenLogs = logs.filter(l => l.forbidden).length;
  const shadowPhase = getShadowPhase();

  // Progress through the current rank band comes from the server (tierProgress); the hidden score never reaches the device.
  const nextRank = ({ E: "D", D: "C", C: "B", B: "A", A: "S", S: null } as Record<string, string | null>)[rank];
  const progressToNext = tierProgress;

  // Rank-up prep: show when within last 20% of current rank
  const showRankUpPrep = nextRank && progressToNext >= 75;

  const unlockedAchievements = achievements.filter(a => a.unlockedAt !== null);
  const unlockedMilestones = milestones.filter(m => m.unlockedAt !== null);

  const weakestExecutionDomain = useMemo(() => {
    if (!perfSummary || perfSummary.byDomain.length === 0) return null;
    const totals: Record<Domain, { attempts: number; completed: number }> = {
      BODY: { attempts: 0, completed: 0 },
      MIND: { attempts: 0, completed: 0 },
      WEALTH: { attempts: 0, completed: 0 },
      SOCIAL: { attempts: 0, completed: 0 },
      DISCIPLINE: { attempts: 0, completed: 0 },
    };
    for (const row of perfSummary.byDomain) {
      if (!(row.domain in totals)) continue;
      const key = row.domain as Domain;
      totals[key].attempts += row.count;
      if (row.status === "complete") totals[key].completed += row.count;
    }
    const ranked = DOMAINS.map((d) => ({
      domain: d,
      rate: totals[d].attempts > 0 ? totals[d].completed / totals[d].attempts : 1,
      attempts: totals[d].attempts,
    })).filter((x) => x.attempts > 0);
    if (ranked.length === 0) return null;
    ranked.sort((a, b) => a.rate - b.rate);
    return ranked[0]?.domain ?? null;
  }, [perfSummary]);

  const sparkline = useMemo(() => {
    if (!perfSummary || perfSummary.daily.length === 0) return "";
    const levels = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    const dayMap = new Map<string, { attempts: number; completed: number }>();
    for (const row of perfSummary.daily) {
      const rec = dayMap.get(row.day) ?? { attempts: 0, completed: 0 };
      rec.attempts += row.count;
      if (row.status === "complete") rec.completed += row.count;
      dayMap.set(row.day, rec);
    }
    const points = Array.from(dayMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-14)
      .map(([, v]) => (v.attempts > 0 ? v.completed / v.attempts : 0));
    if (points.length === 0) return "";
    return points
      .map((p) => levels[Math.max(0, Math.min(levels.length - 1, Math.round(p * (levels.length - 1))))] ?? "▁")
      .join("");
  }, [perfSummary]);

  const shadowPhaseColors: Record<string, string> = {
    DORMANT: colors.mutedForeground, AWAKENED: "#C4873A",
    HUNTING: "#E05555", DOMINANT: "#9B0000",
  };

  if (!user) {
    return (
      <ScreenStatus
        failed={!loading && !!loadError}
        message="The System is out of reach. Check your connection."
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.profileTop}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.systemLabel, { color: colors.mutedForeground }]}>SYSTEM // SELF</Text>
              <Text style={[styles.username, { color: colors.foreground }]}>{user.username}</Text>
              <Text style={[styles.goal, { color: colors.mutedForeground }]} numberOfLines={2}>
                {user.primaryGoal}
              </Text>
            </View>
            <RankBadge rank={rank} size="lg" showLabel />
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>{user.dayNumber}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>DAYS</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>{totalLogs}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>LOGS</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>{completedQuests}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>QUESTS</Text>
            </View>
            {forbiddenLogs > 0 && (
              <>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: "#9B0000", fontFamily: "SpaceMono" }]}>{forbiddenLogs}</Text>
                  <Text style={[styles.statLabel, { color: "#9B0000" }]}>FORBIDDEN</Text>
                </View>
              </>
            )}
          </View>

          {/* Rank Progress */}
          {nextRank && (
            <View style={styles.rankProgress}>
              <View style={styles.rankProgressHeader}>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>RANK PROGRESS → {nextRank}</Text>
                <Text style={[styles.progressPct, { color: colors.primary, fontFamily: "SpaceMono" }]}>
                  {Math.min(100, Math.round(progressToNext))}%
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                <View style={[styles.progressFill, {
                  width: `${Math.min(100, progressToNext)}%` as any,
                  backgroundColor: progressToNext >= 75 ? "#C4873A" : colors.primary,
                }]} />
              </View>
              {showRankUpPrep && (
                <View style={[styles.rankPrepBadge, { borderColor: "#C4873A40", backgroundColor: "#C4873A08" }]}>
                  <Feather name="arrow-up" size={9} color="#C4873A" />
                  <Text style={[styles.rankPrepText, { color: "#C4873A" }]}>
                    PROMOTION THRESHOLD NEAR — Complete rank-up prep missions on Quest Board
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Domain Scores */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DOMAIN SCORES</Text>
          {domainScores.map(ds => (
            <View key={ds.domain}>
              <DomainBar domain={ds.domain} score={ds.score} streak={ds.streak} showStreak />
              {/* Milestone badges under each bar */}
              <View style={styles.milestoneBadgesRow}>
                {MILESTONE_TIERS.map(tier => {
                  const milestone = milestones.find(m => m.domain === ds.domain && m.tier === tier);
                  const unlocked = milestone?.unlockedAt !== null;
                  return (
                    <View
                      key={tier}
                      style={[
                        styles.milestonePip,
                        {
                          backgroundColor: unlocked ? DOMAIN_COLORS[ds.domain] : colors.muted,
                          opacity: unlocked ? 1 : 0.3,
                        },
                      ]}
                    />
                  );
                })}
                {(() => {
                  const topMilestone = milestones
                    .filter(m => m.domain === ds.domain && m.unlockedAt !== null)
                    .sort((a, b) => b.tier - a.tier)[0];
                  return topMilestone ? (
                    <Text style={[styles.milestoneTitle, { color: DOMAIN_COLORS[ds.domain] }]}>
                      {topMilestone.title}
                    </Text>
                  ) : null;
                })()}
              </View>
            </View>
          ))}
        </View>

        {/* Performance */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.expandHeader}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PERFORMANCE (14D)</Text>
            <TouchableOpacity onPress={fetchPerformance} disabled={perfLoading} activeOpacity={0.7}>
              <Text style={[styles.refreshMini, { color: colors.primary }]}>
                {perfLoading ? "SYNCING..." : "REFRESH"}
              </Text>
            </TouchableOpacity>
          </View>
          {perfError ? (
            <View style={styles.expandHeader}>
              <Text style={[styles.calendarTeaser, { color: colors.destructive }]}>{perfError}</Text>
              <TouchableOpacity onPress={fetchPerformance} activeOpacity={0.7}>
                <Text style={[styles.refreshMini, { color: colors.primary }]}>RETRY</Text>
              </TouchableOpacity>
            </View>
          ) : perfSummary ? (
            <>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
                    {perfSummary.completionRate}%
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>COMPLETE RATE</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "SpaceMono" }]}>
                    {perfSummary.completed}/{perfSummary.attempts}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>DONE/ATTEMPTED</Text>
                </View>
              </View>
              {weakestExecutionDomain && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => {
                    router.push({
                      pathname: "/(tabs)/quests",
                      params: { domain: weakestExecutionDomain },
                    });
                  }}
                >
                  <Text style={[styles.calendarTeaser, { color: colors.mutedForeground }]}>
                    Weakest execution domain:{" "}
                    <Text style={{ color: DOMAIN_COLORS[weakestExecutionDomain], fontWeight: "700" }}>
                      {weakestExecutionDomain} (tap to focus)
                    </Text>
                  </Text>
                </TouchableOpacity>
              )}
              {sparkline ? (
                <Text style={[styles.sparkline, { color: colors.primary }]}>{sparkline}</Text>
              ) : (
                <Text style={[styles.calendarTeaser, { color: colors.mutedForeground }]}>
                  No daily completion trend yet.
                </Text>
              )}
            </>
          ) : (
            <Text style={[styles.calendarTeaser, { color: colors.mutedForeground }]}>No performance data yet.</Text>
          )}
        </View>

        {/* Finance (WEALTH): savings rate, budgets, goals, net worth. Private. */}
        <TouchableOpacity
          style={[styles.card, styles.expandHeader, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push("/finance")}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel="Open finance"
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>FINANCE // WEALTH</Text>
          <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
        </TouchableOpacity>

        {/* Weekly recap (its own screen; it left the tab bar when the Clan tab arrived) */}
        <TouchableOpacity
          style={[styles.card, styles.expandHeader, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => router.push("/recap")}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel="Open the weekly recap"
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WEEKLY RECAP</Text>
          <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
        </TouchableOpacity>

        {/* Streak Calendar */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.expandHeader}
            onPress={() => setShowCalendar(c => !c)}
            activeOpacity={0.7}
          >
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>HABIT STREAK CALENDAR</Text>
            <Feather name={showCalendar ? "chevron-up" : "chevron-down"} size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
          {showCalendar && <StreakCalendar logs={logs} weeks={4} />}
          {!showCalendar && (
            <Text style={[styles.calendarTeaser, { color: colors.mutedForeground }]}>
              4-week view · {logs.length} total entries
            </Text>
          )}
        </View>

        {/* Shadow Self */}
        {shadowSelf.active && (
          <View style={[styles.shadowCard, { borderColor: "#E0555540", backgroundColor: "#E0555508" }]}>
            <View style={styles.shadowHeader}>
              <Text style={[styles.shadowTitle, { color: "#E05555" }]}>SHADOW SELF</Text>
              <Text style={[styles.shadowPhase, { color: shadowPhaseColors[shadowPhase] ?? "#E05555" }]}>
                {shadowPhase}
              </Text>
            </View>
            <Text style={[styles.shadowGap, { color: shadowSelf.gap > 0 ? "#E05555" : "#4B8B6F", fontFamily: "SpaceMono" }]}>
              {shadowSelf.gap > 0 ? `+${shadowSelf.gap.toFixed(1)} ahead` : `${Math.abs(shadowSelf.gap).toFixed(1)} behind`}
            </Text>
            <Text style={[styles.shadowText, { color: colors.mutedForeground }]}>
              {shadowPhase === "DOMINANT"
                ? "The Shadow has established full dominance. Emergency countermeasures required across all domains."
                : shadowPhase === "HUNTING"
                ? "Closing in on your position. Daily consistency will close the gap in two weeks."
                : "Active. Gaining at its daily rate. Your logs are the only countermeasure."}
            </Text>
          </View>
        )}

        {/* Achievements */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.expandHeader}
            onPress={() => setShowAchievements(s => !s)}
            activeOpacity={0.7}
          >
            <View style={styles.expandLeft}>
              <Text style={[styles.sectionLabel, { color: "#C4873A" }]}>ACHIEVEMENTS</Text>
              <View style={[styles.countBadge, { backgroundColor: "#C4873A20", borderColor: "#C4873A30" }]}>
                <Text style={[styles.countText, { color: "#C4873A" }]}>
                  {unlockedAchievements.length}/{achievements.length}
                </Text>
              </View>
            </View>
            <Feather name={showAchievements ? "chevron-up" : "chevron-down"} size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
          {showAchievements && (
            <View style={styles.achievementGrid}>
              {achievements.map(a => {
                const def = ACHIEVEMENT_DEFS[a.id];
                const unlocked = a.unlockedAt !== null;
                return (
                  <View
                    key={a.id}
                    style={[
                      styles.achievementTile,
                      {
                        borderColor: unlocked ? "#C4873A50" : colors.border,
                        backgroundColor: unlocked ? "#C4873A0A" : "transparent",
                        opacity: unlocked ? 1 : 0.35,
                      },
                    ]}
                  >
                    <Feather name={def.icon as any} size={16} color={unlocked ? "#C4873A" : colors.mutedForeground} />
                    <Text style={[styles.achievementName, { color: unlocked ? colors.foreground : colors.mutedForeground }]}
                      numberOfLines={2}
                    >
                      {def.title}
                    </Text>
                    {unlocked && (
                      <Text style={[styles.achievementDate, { color: colors.mutedForeground }]}>
                        {new Date(a.unlockedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Domain Milestones */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.expandHeader}
            onPress={() => setShowMilestones(s => !s)}
            activeOpacity={0.7}
          >
            <View style={styles.expandLeft}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DOMAIN MILESTONES</Text>
              <View style={[styles.countBadge, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.countText, { color: colors.mutedForeground }]}>
                  {unlockedMilestones.length}/{milestones.length}
                </Text>
              </View>
            </View>
            <Feather name={showMilestones ? "chevron-up" : "chevron-down"} size={13} color={colors.mutedForeground} />
          </TouchableOpacity>
          {showMilestones && (
            <View style={styles.milestoneList}>
              {DOMAINS.map(domain => {
                const domColor = DOMAIN_COLORS[domain];
                return (
                  <View key={domain} style={styles.milestoneDomainRow}>
                    <Text style={[styles.milestoneDomain, { color: domColor }]}>{domain}</Text>
                    <View style={styles.milestoneTierRow}>
                      {MILESTONE_TIERS.map(tier => {
                        const m = milestones.find(ml => ml.domain === domain && ml.tier === tier);
                        const unlocked = m?.unlockedAt !== null;
                        return (
                          <View
                            key={tier}
                            style={[
                              styles.milestoneTile,
                              {
                                borderColor: unlocked ? domColor + "60" : colors.border,
                                backgroundColor: unlocked ? domColor + "10" : "transparent",
                              },
                            ]}
                          >
                            <Text style={[styles.milestoneTierNum, { color: unlocked ? domColor : colors.mutedForeground }]}>
                              {tier}
                            </Text>
                            <Text style={[styles.milestoneTileTitle, {
                              color: unlocked ? colors.foreground : colors.mutedForeground,
                              opacity: unlocked ? 1 : 0.4,
                            }]} numberOfLines={2}>
                              {MILESTONE_TITLES[domain][tier]}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Nightly Debrief */}
        <TouchableOpacity
          style={[styles.debriefBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => void debriefQ.refetch()}
          activeOpacity={0.8}
          disabled={debriefQ.isFetching}
        >
          <Feather name="moon" size={16} color={colors.mutedForeground} />
          <Text style={[styles.debriefBtnText, { color: colors.mutedForeground }]}>
            {debriefQ.isFetching ? "CHECKING..." : "CHECK TODAY'S DEBRIEF"}
          </Text>
        </TouchableOpacity>

        {debrief ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SystemMessage message={debrief} animate label="NIGHTLY DEBRIEF" />
          </View>
        ) : debriefOpensAt ? (
          <Text style={[styles.calendarTeaser, { color: colors.mutedForeground }]}>
            The debrief opens at {debriefOpensAt}.
          </Text>
        ) : debriefQ.isError ? (
          <Text style={[styles.calendarTeaser, { color: colors.destructive }]}>The System is out of reach.</Text>
        ) : null}

        {/* Deferral ledger: the user's own refusal reasons, newest first. Never shared with rivals or clans. */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{LEDGER_HEADER}</Text>
          {ledger ? (
            <>
              <Text style={[styles.settingValue, { color: colors.foreground }]}>
                {ledger.countThisWeek === 0
                  ? "No deferrals this week."
                  : `You deferred ${ledger.countThisWeek} time${ledger.countThisWeek === 1 ? "" : "s"} this week.`}
              </Text>
              {ledger.items.slice(0, 10).map((item, i) => (
                <Text key={`${item.localDate}-${i}`} style={[styles.settingLabel, { color: colors.mutedForeground }]}>
                  {ledgerLine(item)}
                </Text>
              ))}
            </>
          ) : ledgerQ.isError ? (
            <Text style={[styles.settingValue, { color: colors.destructive }]}>The System is out of reach.</Text>
          ) : (
            <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>Reading the ledger.</Text>
          )}
        </View>

        {/* Settings */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SETTINGS</Text>
          <View style={styles.settingRow}>
            <Feather name="eye" size={14} color={colors.mutedForeground} />
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Identity</Text>
            <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>
              {user.identitySetting.toUpperCase()}
            </Text>
          </View>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <Feather name="sun" size={14} color={colors.mutedForeground} />
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Morning Briefing</Text>
            <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>{user.morningTime}</Text>
          </View>
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <View style={styles.settingRow}>
            <Feather name="moon" size={14} color={colors.mutedForeground} />
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Nightly Debrief</Text>
            <Text style={[styles.settingValue, { color: colors.mutedForeground }]}>{user.nightlyTime}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },
  profileCard: { padding: 16, borderRadius: 4, borderWidth: 1, gap: 16 },
  profileTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  systemLabel: { fontSize: 9, letterSpacing: 3, fontWeight: "600" as const, marginBottom: 2 },
  username: { fontSize: 22, fontWeight: "700" as const, letterSpacing: 1 },
  goal: { fontSize: 12, lineHeight: 18, marginTop: 4, maxWidth: 180 },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 20, fontWeight: "700" as const },
  statLabel: { fontSize: 8, letterSpacing: 2, fontWeight: "600" as const },
  statDivider: { width: 1, height: 32 },
  rankProgress: { gap: 6 },
  rankProgressHeader: { flexDirection: "row", justifyContent: "space-between" },
  progressPct: { fontSize: 12, fontWeight: "700" as const },
  progressTrack: { height: 2, borderRadius: 1, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 1 },
  rankPrepBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 6,
  },
  rankPrepText: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 1, flex: 1 },
  card: { padding: 16, borderRadius: 4, borderWidth: 1, gap: 12 },
  sectionLabel: { fontSize: 9, letterSpacing: 3, fontWeight: "600" as const },
  milestoneBadgesRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, marginBottom: 8 },
  milestonePip: { width: 8, height: 4, borderRadius: 2 },
  milestoneTitle: { fontSize: 8, fontWeight: "800" as const, letterSpacing: 1.5, marginLeft: 4 },
  expandHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  expandLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  countBadge: {
    borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10,
  },
  countText: { fontSize: 8, fontWeight: "800" as const, letterSpacing: 1 },
  calendarTeaser: { fontSize: 10, letterSpacing: 0.5, fontStyle: "italic" },
  refreshMini: { fontSize: 9, letterSpacing: 1.5, fontWeight: "700" as const },
  sparkline: { fontSize: 18, letterSpacing: 1, fontFamily: "SpaceMono" },
  shadowCard: { padding: 14, borderRadius: 4, borderWidth: 1, gap: 8 },
  shadowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  shadowTitle: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2 },
  shadowPhase: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2 },
  shadowGap: { fontSize: 14, fontWeight: "700" as const },
  shadowText: { fontSize: 12, lineHeight: 18 },
  achievementGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  achievementTile: {
    width: "47%", borderWidth: 1, borderRadius: 4,
    padding: 10, gap: 6, alignItems: "center",
  },
  achievementName: { fontSize: 9, fontWeight: "700" as const, letterSpacing: 0.5, textAlign: "center" },
  achievementDate: { fontSize: 8, letterSpacing: 0.5 },
  milestoneList: { gap: 14 },
  milestoneDomainRow: { gap: 8 },
  milestoneDomain: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 3 },
  milestoneTierRow: { flexDirection: "row", gap: 6 },
  milestoneTile: {
    flex: 1, borderWidth: 1, borderRadius: 4, padding: 8, alignItems: "center", gap: 4,
  },
  milestoneTierNum: { fontSize: 13, fontWeight: "800" as const },
  milestoneTileTitle: { fontSize: 8, fontWeight: "600" as const, textAlign: "center", letterSpacing: 0.5, lineHeight: 12 },
  debriefBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, padding: 14, borderRadius: 4, borderWidth: 1,
  },
  debriefBtnText: { fontSize: 10, letterSpacing: 2, fontWeight: "600" as const },
  settingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  settingLabel: { flex: 1, fontSize: 13 },
  settingValue: { fontSize: 11, letterSpacing: 1 },
  separator: { height: StyleSheet.hairlineWidth },
});
