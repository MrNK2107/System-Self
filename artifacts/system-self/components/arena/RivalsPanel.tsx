// Rivals panel: your standing against your rivals (GET /api/rivals, polled every minute while focused). One ranked
// list with you highlighted; the Shadow Self and Past You sit below as rows; a rival's domains, challenges and
// transmissions open in sheets. Ghost rivals (server simulations for the cold start) read "Simulated", and the
// feed badge says LIVE only when at least one rival is a real player. The composite is the plain mean of the five
// visible domain scores; the hidden score never reaches the app.
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RankedDomain, Rival, RivalChallenge } from "@workspace/contracts";

import { ChallengeModal, type ChallengeTarget } from "@/components/ChallengeModal";
import { GapFigure, Group, Notice, RankMark, Section, Sheet, useToneColor } from "@/components/arena/parts";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { SystemWindow } from "@/components/ui/SystemWindow";
import { ALL_DOMAINS as DOMAINS, DOMAIN_COLORS } from "@/constants/domains";
import { space, type } from "@/constants/type";
import { scoreRecord, useApp, type Domain } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useGameStateQuery, usePastSelfQuery, useShadowTakeoversQuery } from "@/hooks/useGameState";
import { useRivalActions, useRivalsQuery } from "@/hooks/useRivals";
import { agoLabel } from "@/lib/duo/duo";
import { shadowTallyLine } from "@/lib/game/adherence";
import { pastSelfRows, gymLine } from "@/lib/game/progress";
import { gapFromUser, gapLine, pastSelfGap, rivalsFeed, shadowGap, signed, standingLine } from "@/lib/social/arena";
import {
  buildLeaderboard,
  challengeProgress,
  composite as compositeOf,
  declareOutcomeMessage,
  describeRivalError,
  leaderStatus,
  shortCodename,
  type LeaderEntry,
  type LeaderStatus,
} from "@/lib/social/rivals";

const STATUS_WORDS: Record<LeaderStatus, string> = {
  THREATENING: "Ahead and rising",
  AHEAD: "Ahead of you",
  CLOSING: "Closing in",
  BEHIND: "Behind you",
  SHADOW: "Your shadow",
};

const TRAJECTORY_WORDS = { up: "Rising", stable: "Steady", down: "Falling" } as const;

const OUTCOME_LABEL = { win: "Victory", loss: "Defeat", draw: "Stalemate", void: "Void" } as const;

type SheetKind = "rival" | "shadow" | "past" | "challenges" | "transmissions" | "how" | null;

// --- ranked row ---------------------------------------------------------------------------------

function RankedRow({ entry, position, userComposite, onPress }: { entry: LeaderEntry; position: number; userComposite: number; onPress?: () => void }) {
  const colors = useColors();
  const isUser = entry.kind === "you";
  const gap = gapFromUser(userComposite, entry.composite);
  const status = leaderStatus(entry, userComposite);
  const sub = isUser
    ? "You"
    : [status ? STATUS_WORDS[status] : null, entry.isGhost ? "Simulated" : null, entry.shadowActive ? "Shadow active" : null]
        .filter(Boolean)
        .join(" · ");
  const name = entry.kind === "rival" ? shortCodename(entry.label) : entry.label;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: "rgba(168,121,255,0.12)" } : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`Position ${position}, ${name}, rank ${entry.rank}, composite ${entry.composite.toFixed(1)}${isUser ? "" : `, ${gapLine(gap)}`}`}
      style={[s.row, { borderBottomColor: colors.border, backgroundColor: isUser ? colors.muted : "transparent" }]}
    >
      <Text style={[type.label, s.pos, { color: isUser ? colors.primary : colors.mutedForeground }]}>#{position}</Text>
      <RankMark rank={entry.rank} />
      <View style={s.rowText}>
        <Text style={[type.bodyStrong, { color: isUser ? colors.primary : colors.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[type.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <View style={s.rowEnd}>
        <Text style={[type.number, { color: colors.foreground }]}>{entry.composite.toFixed(1)}</Text>
        {isUser ? null : <GapFigure gap={gap} size="meta" />}
      </View>
    </Pressable>
  );
}

// --- domain comparison rows (used by the rival, shadow and past-you sheets) ----------------------

function DomainRows({ mine, theirs, theirLabel }: { mine: Record<Domain, number>; theirs: Record<Domain, number>; theirLabel: string }) {
  return (
    <Group>
      {DOMAINS.map((d) => {
        const gap = gapFromUser(mine[d] ?? 0, theirs[d] ?? 0);
        return (
          <ListRow
            key={d}
            title={d}
            dot={DOMAIN_COLORS[d]}
            subtitle={`You ${(mine[d] ?? 0).toFixed(1)} · ${theirLabel} ${(theirs[d] ?? 0).toFixed(1)}`}
            trailing={<GapFigure gap={gap} size="meta" />}
            accessibilityLabel={`${d}: ${gapLine(gap)}`}
          />
        );
      })}
    </Group>
  );
}

// --- panel --------------------------------------------------------------------------------------

export function RivalsPanel() {
  const colors = useColors();
  const tone = useToneColor();
  const { domainScores, shadowSelf, user, trajectory, getShadowScores, getShadowRank } = useApp();
  const today = useGameStateQuery().data?.today ?? new Date().toISOString().slice(0, 10);
  const rivalsQ = useRivalsQuery();
  const actions = useRivalActions();
  const takeovers = useShadowTakeoversQuery().data?.items ?? [];
  const pastSelf = usePastSelfQuery().data;

  const [sheet, setSheet] = useState<SheetKind>(null);
  const [selected, setSelected] = useState<Rival | null>(null);
  const [challengeTarget, setChallengeTarget] = useState<Rival | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taunting, setTaunting] = useState<string | null>(null);

  const userScores = scoreRecord(domainScores);
  const data = rivalsQ.data;
  const rivals = data?.rivals ?? [];
  const rank = user?.rank ?? "E";
  const board = data ? buildLeaderboard({ handle: user?.username ?? "YOU", rank, trajectory, scores: userScores }, data) : null;
  const challenges = data?.challenges ?? [];
  const activeChallenges = challenges.filter((c) => c.outcome === null);
  const results = challenges.filter((c) => c.outcome !== null);
  const toAck = results.filter((c) => !c.acknowledged && c.outcome !== "void").length;
  const record = data?.record ?? { wins: 0, losses: 0, draws: 0 };
  const taunts = data?.taunts ?? [];
  const unread = taunts.filter((t) => !t.read).length;
  const totalRecord = record.wins + record.losses + record.draws;
  const feed = rivalsFeed(rivals);
  const now = new Date();

  const shadowScores = (data?.shadow?.scores ?? getShadowScores()) as Record<Domain, number>;
  const shadowName = data?.shadow?.codename ?? shadowSelf.codename;
  const shadowLine = shadowGap(shadowScores, userScores);
  const pastGap = pastSelf ? pastSelfGap(pastSelf) : null;

  const activeFor = (assignmentId: string) => activeChallenges.find((c) => c.assignmentId === assignmentId) ?? null;
  const target: ChallengeTarget | null = challengeTarget
    ? {
        codename: challengeTarget.codename,
        rank: challengeTarget.profile.rank,
        trajectory: challengeTarget.profile.trajectory,
        scores: (challengeTarget.profile.scores ?? userScores) as Record<Domain, number>,
      }
    : null;

  const report = (r: { ok: boolean }) => {
    if (!r.ok) setError("Queued entries are still syncing. Retry once they land.");
  };
  // The sheet shows the outcome itself: null once the server confirmed the challenge, else the reason.
  const handleDeclare = (domain: Domain): Promise<string | null> => {
    if (!challengeTarget) return Promise.resolve("That rival is gone. Pull to refresh.");
    setError(null);
    return declareOutcomeMessage(() => actions.challenge(challengeTarget.assignmentId, domain as RankedDomain));
  };
  const handleTaunt = async (rival: Rival) => {
    if (taunting) return;
    setError(null);
    setTaunting(rival.assignmentId);
    try {
      report(await actions.taunt(rival.assignmentId));
    } catch (e) {
      setError(describeRivalError(e));
    } finally {
      setTaunting(null);
    }
  };
  const handleAck = async (challengeId: string) => {
    setError(null);
    try {
      report(await actions.acknowledge(challengeId));
    } catch (e) {
      setError(describeRivalError(e));
    }
  };
  const handleMarkRead = async () => {
    try {
      report(await actions.markRead());
    } catch (e) {
      setError(describeRivalError(e));
    }
  };

  const openRival = (r: Rival) => {
    setSelected(r);
    setSheet("rival");
  };
  const openEntry = (e: LeaderEntry) => {
    if (e.kind === "shadow") return setSheet("shadow");
    const r = rivals.find((x) => x.assignmentId === e.id);
    if (r) openRival(r);
  };
  const close = () => setSheet(null);

  // --- selected rival (kept fresh from the latest poll) ---
  const rival = selected ? (rivals.find((r) => r.assignmentId === selected.assignmentId) ?? selected) : null;
  const rivalScores = rival
    ? ((rival.profile.scores ?? Object.fromEntries(DOMAINS.map((d) => [d, 0]))) as Record<Domain, number>)
    : null;
  const rivalGap = rival && rivalScores && board ? gapFromUser(board.userComposite, compositeOf(rivalScores)) : null;
  const rivalChallenge = rival ? activeFor(rival.assignmentId) : null;

  return (
    <>
      <SystemWindow title="STANDING">
        <Text style={[type.title, { color: colors.foreground }]}>
          {board ? standingLine(board.position, board.entries.length) : rivalsQ.isError ? "The rival feed is out of reach." : "Syncing rivals."}
        </Text>
        {board ? (
          <View style={s.metaLine}>
            <Text style={[type.meta, s.flex, { color: colors.mutedForeground }]}>
              Composite {board.userComposite.toFixed(1)}
              {totalRecord > 0 ? ` · Record ${record.wins}W ${record.losses}L ${record.draws}D` : ""}
            </Text>
            {feed ? (
              <Text
                style={[type.label, { color: feed === "LIVE" ? colors.primary : colors.subtle }]}
                accessibilityLabel={feed === "LIVE" ? "Live rivals" : "Every rival is simulated"}
              >
                {feed}
              </Text>
            ) : null}
          </View>
        ) : null}
      </SystemWindow>

      {error ? <Notice message={error} /> : null}
      {!data && rivalsQ.isError ? <Notice message={describeRivalError(rivalsQ.error)} onRetry={() => void rivalsQ.refetch()} /> : null}

      {board ? (
        <Section label="Ranked by composite">
          <Group>
            {board.entries.map((entry, i) => (
              <RankedRow
                key={entry.id}
                entry={entry}
                position={i + 1}
                userComposite={board.userComposite}
                onPress={entry.kind === "you" ? undefined : () => openEntry(entry)}
              />
            ))}
          </Group>
        </Section>
      ) : null}

      <Section label="Yourself">
        <Group>
          {shadowSelf.active ? (
            <ListRow
              title={`Shadow Self · ${shadowName}`}
              subtitle={shadowLine.line}
              trailing={<GapFigure gap={shadowLine} size="meta" />}
              chevron
              onPress={() => setSheet("shadow")}
            />
          ) : (
            <ListRow
              title="Shadow Self"
              subtitle={takeovers.length > 0 ? `Dormant. It took ${takeovers.length} session${takeovers.length === 1 ? "" : "s"} you refused.` : "Dormant. It wakes when you slip."}
              chevron
              onPress={() => setSheet("shadow")}
            />
          )}
          {pastSelf && pastGap ? (
            <ListRow
              title="Past you"
              subtitle={pastGap.line}
              trailing={<GapFigure gap={pastGap} size="meta" />}
              chevron
              onPress={() => setSheet("past")}
            />
          ) : null}
        </Group>
      </Section>

      <Section label="Activity">
        <Group>
          <ListRow
            title="Rival challenges"
            subtitle={`${activeChallenges.length} running · ${results.length} finished`}
            trailing={toAck > 0 ? <Text style={[type.label, { color: colors.primary }]}>{toAck} NEW</Text> : undefined}
            chevron
            onPress={() => setSheet("challenges")}
          />
          <ListRow
            title="Transmissions"
            subtitle={taunts.length === 0 ? "None received." : `${taunts.length} received`}
            trailing={unread > 0 ? <Text style={[type.label, { color: colors.primary }]}>{unread} UNREAD</Text> : undefined}
            chevron
            onPress={() => setSheet("transmissions")}
          />
          <ListRow title="How rivals work" chevron onPress={() => setSheet("how")} />
        </Group>
      </Section>

      {/* --- rival detail --- */}
      <Sheet visible={sheet === "rival" && !!rival} title={rival ? shortCodename(rival.codename) : "Rival"} onClose={close}>
        {rival && rivalScores && rivalGap ? (
          <>
            <View style={s.sheetHead}>
              <RankMark rank={rival.profile.rank} />
              <Text style={[type.meta, s.flex, { color: colors.mutedForeground }]}>
                {[TRAJECTORY_WORDS[rival.profile.trajectory], rival.isGhost ? "Simulated rival" : "Real player", rival.profile.shadowActive ? "Shadow active" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Text style={[type.title, { color: tone(rivalGap.tone) }]}>{gapLine(rivalGap)}</Text>
            <DomainRows mine={userScores} theirs={rivalScores} theirLabel="Them" />
            {rivalChallenge ? (
              <ChallengeLine c={rivalChallenge} today={today} />
            ) : (
              <Button
                label="Declare 7-day challenge"
                block
                onPress={() => {
                  setSheet(null);
                  setChallengeTarget(rival);
                }}
              />
            )}
            <Button
              label="Send a transmission"
              variant="tonal"
              block
              loading={taunting === rival.assignmentId}
              onPress={() => void handleTaunt(rival)}
            />
            {error ? <Notice message={error} /> : null}
          </>
        ) : null}
      </Sheet>

      {/* --- shadow self --- */}
      <Sheet visible={sheet === "shadow"} title={shadowSelf.active ? shadowName : "Shadow Self"} onClose={close}>
        {shadowSelf.active || data?.shadow ? (
          <>
            <View style={s.sheetHead}>
              <RankMark rank={data?.shadow?.rank ?? getShadowRank()} />
              <Text style={[type.meta, s.flex, { color: colors.mutedForeground }]}>The version of you that does not skip.</Text>
            </View>
            <Text style={[type.title, { color: tone(shadowLine.tone) }]}>{shadowLine.line}</Text>
            <DomainRows mine={userScores} theirs={shadowScores} theirLabel="Shadow" />
          </>
        ) : (
          <Text style={[type.body, { color: colors.mutedForeground }]}>Your shadow is dormant. Slip, and it starts gaining on you.</Text>
        )}
        {takeovers.length > 0 ? (
          <Section label={`Takeovers · ${takeovers.length}`}>
            {takeovers.slice(0, 5).map((t, i) => (
              <Text key={`${t.localDate}-${i}`} style={[type.body, { color: colors.mutedForeground }]}>
                {shadowTallyLine(t.questTitle)}
              </Text>
            ))}
          </Section>
        ) : null}
      </Sheet>

      {/* --- past you --- */}
      <Sheet visible={sheet === "past" && !!pastSelf} title="Past you" onClose={close}>
        {pastSelf && pastGap ? (
          <>
            <Text style={[type.title, { color: tone(pastGap.tone) }]}>{pastGap.line}</Text>
            <Group>
              {pastSelfRows(pastSelf).map((r) => (
                <ListRow
                  key={r.domain}
                  title={r.domain}
                  dot={DOMAIN_COLORS[r.domain]}
                  subtitle={`${r.baseline} then · ${r.current} now`}
                  trailing={
                    <Text style={[type.bodyStrong, { color: r.direction === "up" ? colors.success : r.direction === "down" ? colors.destructive : colors.mutedForeground }]}>
                      {r.delta}
                    </Text>
                  }
                />
              ))}
            </Group>
            <Text style={[type.meta, { color: colors.mutedForeground }]}>Gym: {gymLine(pastSelf.gym)}</Text>
          </>
        ) : null}
      </Sheet>

      {/* --- rival challenges --- */}
      <Sheet visible={sheet === "challenges"} title="Rival challenges" onClose={close}>
        {totalRecord > 0 ? (
          <Text style={[type.meta, { color: colors.mutedForeground }]}>
            Record: {record.wins} won · {record.losses} lost · {record.draws} drawn
          </Text>
        ) : null}
        {activeChallenges.length === 0 && results.length === 0 ? (
          <Text style={[type.body, { color: colors.mutedForeground }]}>No rival challenges yet. Open a rival to declare one.</Text>
        ) : null}
        {activeChallenges.length > 0 ? (
          <Section label="Running">
            {activeChallenges.map((c) => (
              <ChallengeLine key={c.id} c={c} today={today} />
            ))}
          </Section>
        ) : null}
        {results.length > 0 ? (
          <Section label="Finished">
            <Group>
              {results.map((c) => {
                const outcome = c.outcome ?? "void";
                const color = outcome === "win" ? colors.success : outcome === "loss" ? colors.destructive : outcome === "draw" ? colors.warn : colors.subtle;
                const canAck = !c.acknowledged && outcome !== "void";
                return (
                  <ListRow
                    key={c.id}
                    title={`${OUTCOME_LABEL[outcome]} · ${c.domain} vs ${shortCodename(c.codename)}`}
                    subtitle={`Ended ${c.endDate}`}
                    dot={color}
                    trailing={canAck ? <Button label="Acknowledge" variant="text" onPress={() => void handleAck(c.id)} /> : undefined}
                  />
                );
              })}
            </Group>
          </Section>
        ) : null}
        {error ? <Notice message={error} /> : null}
      </Sheet>

      {/* --- transmissions --- */}
      <Sheet visible={sheet === "transmissions"} title="Transmissions" onClose={close}>
        {taunts.length === 0 ? (
          <Text style={[type.body, { color: colors.mutedForeground }]}>No transmissions. Rivals speak when you fall behind.</Text>
        ) : (
          <>
            <Group>
              {taunts.map((t) => (
                <ListRow
                  key={t.id}
                  title={`"${t.message}"`}
                  subtitle={[shortCodename(t.codename), t.isGhost ? "Simulated" : null, agoLabel(t.createdAt, now)].filter(Boolean).join(" · ")}
                  dot={t.read ? undefined : colors.primary}
                />
              ))}
            </Group>
            {unread > 0 ? <Button label="Mark all read" variant="tonal" block onPress={() => void handleMarkRead()} /> : null}
          </>
        )}
      </Sheet>

      {/* --- how rivals work --- */}
      <Sheet visible={sheet === "how"} title="How rivals work" onClose={close}>
        <Text style={[type.body, { color: colors.foreground }]}>
          Rivals are players near your rank, shown by codename only. Until a real match is found, a slot holds a simulated rival and is
          marked Simulated.
        </Text>
        <Text style={[type.body, { color: colors.mutedForeground }]}>
          Composite is the average of your five domain scores. The gap is your composite minus theirs: green when you lead, red when you
          trail.
        </Text>
        <Text style={[type.body, { color: colors.mutedForeground }]}>
          Slots re-match every 30 days and on a rank change. A rival challenge compares 7-day gains in one domain.
        </Text>
      </Sheet>

      <ChallengeModal visible={challengeTarget !== null} rival={target} onClose={() => setChallengeTarget(null)} onDeclare={handleDeclare} />
    </>
  );
}

/** A running rival challenge in one block: domain vs rival, days left, both gains, who leads. */
function ChallengeLine({ c, today }: { c: RivalChallenge; today: string }) {
  const colors = useColors();
  const tone = useToneColor();
  const p = challengeProgress(c, today);
  const gap = gapFromUser(p.userGain, p.rivalGain);
  return (
    <Group>
      <ListRow
        title={`${c.domain} vs ${shortCodename(c.codename)}`}
        dot={DOMAIN_COLORS[c.domain]}
        subtitle={`${p.daysLeft} day${p.daysLeft === 1 ? "" : "s"} left · you ${signed(p.userGain)} · them ${signed(p.rivalGain)}`}
        trailing={
          <Text style={[type.label, { color: tone(gap.tone) }]}>{gap.tone === "lead" ? "LEADING" : gap.tone === "trail" ? "TRAILING" : "TIED"}</Text>
        }
      />
      <View style={[s.track, { backgroundColor: colors.muted }]}>
        <View style={[s.fill, { width: `${p.pct}%`, backgroundColor: DOMAIN_COLORS[c.domain] }]} />
      </View>
    </Group>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  metaLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pos: { width: 28 },
  rowText: { flex: 1, gap: 2 },
  rowEnd: { alignItems: "flex-end" },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  track: { height: 4 },
  fill: { height: 4 },
});
