// Server DTOs -> the app's game shapes (types.ts). Pure, no React Native imports.
import {
  ChainTemplatesResponseSchema,
  LogRequestSchema,
  RANKED_DOMAIN_VALUES,
  type GameLog,
  type GameQuest,
  type GameState,
} from "@workspace/contracts";
import { ACHIEVEMENT_DEFS, MILESTONE_TIERS, MILESTONE_TITLES, SHADOW_GAIN_RATES } from "@workspace/engine";
import type { z } from "zod";
import type { OutboxItem } from "../api/outbox";
import type {
  Achievement,
  Domain,
  DomainMilestone,
  DomainScore,
  LogEntry,
  Quest,
  ChainTemplate,
  QuestChain,
  ShadowSelf,
  User,
} from "./types";

export const DOMAINS: readonly Domain[] = RANKED_DOMAIN_VALUES;

export function isDomain(v: unknown): v is Domain {
  return typeof v === "string" && (DOMAINS as readonly string[]).includes(v);
}

export function toAppUser(profile: GameState["profile"], authUser: { id: string; createdAt: string }): User {
  return {
    id: authUser.id,
    username: profile.username,
    codename: profile.codename,
    identitySetting: profile.identitySetting,
    rank: profile.rank,
    primaryGoal: profile.primaryGoal,
    biggestWeakness: profile.biggestWeakness,
    morningTime: profile.morningTime,
    nightlyTime: profile.nightlyTime,
    onboardingComplete: true,
    createdAt: authUser.createdAt,
    dayNumber: profile.dayNumber,
  };
}

/** All five ranked domains, in canonical order. A domain missing from the server reads as 0. */
export function toDomainScores(scores: GameState["scores"]): DomainScore[] {
  return DOMAINS.map((domain) => {
    const s = scores.find((x) => x.domain === domain);
    return { domain, score: s?.score ?? 0, streak: s?.streak ?? 0, lastLog: s?.lastLogDate ?? null };
  });
}

export function scoreRecord(scores: DomainScore[]): Record<Domain, number> {
  const out = {} as Record<Domain, number>;
  for (const d of DOMAINS) out[d] = scores.find((s) => s.domain === d)?.score ?? 0;
  return out;
}

export function weakestDomain(scores: DomainScore[]): Domain {
  let weakest: DomainScore | undefined;
  for (const s of scores) if (!weakest || s.score < weakest.score) weakest = s;
  return weakest?.domain ?? "DISCIPLINE";
}

const ZERO_SCORES = (): Record<Domain, number> => ({ BODY: 0, MIND: 0, WEALTH: 0, SOCIAL: 0, DISCIPLINE: 0 });

export function toShadowSelf(shadow: GameState["shadow"]): ShadowSelf {
  const dailyGainRate = { ...SHADOW_GAIN_RATES };
  if (!shadow) {
    return { active: false, codename: "SHADOW // SELF", gap: 0, phase: "DORMANT", rank: "E", scores: ZERO_SCORES(), dailyGainRate };
  }
  return {
    active: shadow.active,
    codename: shadow.codename,
    gap: shadow.gap,
    phase: shadow.phase,
    rank: shadow.rank,
    scores: { ...shadow.scores },
    dailyGainRate,
  };
}

function entryData(data: unknown, freeText: string | null | undefined): Record<string, unknown> {
  const base = data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {};
  if (freeText) base.note = freeText;
  return base;
}

export function toLogEntry(log: GameLog): LogEntry {
  return {
    id: log.id,
    clientId: log.clientId,
    domain: log.domain,
    type: log.logType,
    forbidden: log.forbidden,
    data: entryData(log.data, log.freeText),
    timestamp: log.occurredAt,
    pending: false,
  };
}

type LogBody = z.infer<typeof LogRequestSchema>;

/** Queued POST /api/logs items, shown as pending log entries until the server has them. */
export function pendingLogEntries(items: readonly OutboxItem[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const item of items) {
    if (item.path !== "/api/logs") continue;
    const parsed = LogRequestSchema.safeParse(item.body);
    if (!parsed.success) continue;
    const body: LogBody = parsed.data;
    out.push({
      id: body.clientId,
      clientId: body.clientId,
      domain: body.domain,
      type: body.logType,
      forbidden: body.forbidden ?? false,
      data: entryData(body.data, body.freeText),
      timestamp: body.occurredAt ?? new Date().toISOString(),
      pending: true,
    });
  }
  return out;
}

/** Oldest-first list: the server's logs (it returns newest first) plus pending ones it does not have yet. */
export function mergeLogs(serverNewestFirst: readonly GameLog[], pending: readonly LogEntry[]): LogEntry[] {
  const server = [...serverNewestFirst].reverse().map(toLogEntry);
  const known = new Set(server.map((l) => l.clientId));
  const extra = pending.filter((p) => !known.has(p.clientId));
  return [...server, ...extra].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function toQuest(q: GameQuest): Quest {
  const quest: Quest = {
    id: q.id,
    type: q.type,
    title: q.title,
    description: q.description,
    domain: isDomain(q.domain) ? q.domain : "DISCIPLINE",
    status: q.status,
    expiresAt: q.expiresAt,
    generatedBySystem: true,
  };
  if (q.chainId) quest.chainId = q.chainId;
  if (q.chainStep !== null) quest.chainStep = q.chainStep;
  if (q.chainTotal !== null) quest.chainTotal = q.chainTotal;
  return quest;
}

export function toQuestChains(res: z.infer<typeof ChainTemplatesResponseSchema>): QuestChain[] {
  const out: QuestChain[] = [];
  for (const a of res.active) {
    const t = res.templates.find((x) => x.templateKey === a.templateKey);
    if (!t) continue;
    out.push({
      id: t.templateKey,
      templateKey: t.templateKey,
      name: t.name,
      description: t.description,
      domain: t.domain,
      steps: t.steps,
      currentStep: a.currentStep,
      totalSteps: t.steps.length,
      status: "active",
    });
  }
  return out;
}

export function toChainTemplates(res: z.infer<typeof ChainTemplatesResponseSchema>): ChainTemplate[] {
  return res.templates.map((t) => ({
    templateKey: t.templateKey,
    name: t.name,
    description: t.description,
    domain: t.domain,
    steps: t.steps,
  }));
}

export function toAchievements(unlocked: GameState["achievements"]): Achievement[] {
  return (Object.keys(ACHIEVEMENT_DEFS) as (keyof typeof ACHIEVEMENT_DEFS)[]).map((id) => ({
    id,
    unlockedAt: unlocked.find((a) => a.id === id)?.unlockedAt ?? null,
  }));
}

export function toMilestones(unlocked: GameState["milestones"]): DomainMilestone[] {
  const out: DomainMilestone[] = [];
  for (const domain of DOMAINS) {
    for (const tier of MILESTONE_TIERS) {
      out.push({
        domain,
        tier,
        title: MILESTONE_TITLES[domain][tier],
        unlockedAt: unlocked.find((m) => m.domain === domain && m.tier === tier)?.unlockedAt ?? null,
      });
    }
  }
  return out;
}
