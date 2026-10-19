// Rivals, challenges and taunts stay on the device until P5. They are compared against the server scores.
// They belong to the signed-in user: sign-out / an account switch removes the keys (lib/api/user-scope.ts) and
// this hook starts over from the defaults whenever the user id changes.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Challenge,
  ChallengeOutcome,
  ChallengeRecord,
  DomainScore,
  Rank,
  Rival,
  RivalDomain,
  RivalTaunt,
} from "@/lib/game/types";

import { RIVAL_KEYS } from "@/lib/game/rival-keys";

export { RIVAL_KEYS };

const DEFAULT_RIVALS: Rival[] = [
  {
    codename: "RIVAL // ECHO-7", rank: "D",
    bodyScore: 52.3, mindScore: 48.1, wealthScore: 55.0, disciplineScore: 49.5,
    trajectory: "up", shadowActive: false, lastTauntDate: null,
  },
  {
    codename: "RIVAL // PHANTOM-3", rank: "D",
    bodyScore: 47.8, mindScore: 53.2, wealthScore: 44.5, disciplineScore: 51.0,
    trajectory: "stable", shadowActive: true, lastTauntDate: null,
  },
];

const DEFAULT_RECORD: ChallengeRecord = { wins: 0, losses: 0, draws: 0 };

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 11);
}

const today = () => new Date().toISOString().split("T")[0]!;

export function rivalScore(rival: Rival, domain: RivalDomain): number {
  return domain === "BODY" ? rival.bodyScore
    : domain === "MIND" ? rival.mindScore
    : domain === "WEALTH" ? rival.wealthScore
    : rival.disciplineScore;
}

function resolveExpired(challenges: Challenge[], record: ChallengeRecord): { challenges: Challenge[]; record: ChallengeRecord; changed: boolean } {
  const now = today();
  let changed = false;
  let rec = { ...record };
  const next = challenges.map((c) => {
    if (c.outcome !== null || c.endDate >= now) return c;
    const userGain = c.userCurrentScore - c.userStartScore;
    const rivalGain = c.rivalCurrentScore - c.rivalStartScore;
    const outcome: ChallengeOutcome = userGain > rivalGain ? "win" : userGain < rivalGain ? "loss" : "draw";
    rec = {
      wins: rec.wins + (outcome === "win" ? 1 : 0),
      losses: rec.losses + (outcome === "loss" ? 1 : 0),
      draws: rec.draws + (outcome === "draw" ? 1 : 0),
    };
    changed = true;
    return { ...c, outcome };
  });
  return { challenges: next, record: rec, changed };
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function useLocalRivals(domainScores: DomainScore[], userId: string | null) {
  const [rivals, setRivals] = useState<Rival[]>(DEFAULT_RIVALS);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengeRecord, setChallengeRecord] = useState<ChallengeRecord>(DEFAULT_RECORD);
  const [rivalTaunts, setRivalTaunts] = useState<RivalTaunt[]>([]);
  const [loaded, setLoaded] = useState(false);

  // A different account (or none) starts from the defaults, then loads what storage holds for it.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setRivals(DEFAULT_RIVALS);
    setChallenges([]);
    setChallengeRecord(DEFAULT_RECORD);
    setRivalTaunts([]);
    if (!userId) return;
    (async () => {
      try {
        const [r, c, rec, t] = await Promise.all([
          AsyncStorage.getItem(RIVAL_KEYS.RIVALS),
          AsyncStorage.getItem(RIVAL_KEYS.CHALLENGES),
          AsyncStorage.getItem(RIVAL_KEYS.CHALLENGE_RECORD),
          AsyncStorage.getItem(RIVAL_KEYS.RIVAL_TAUNTS),
        ]);
        if (cancelled) return;
        const resolved = resolveExpired(parse<Challenge[]>(c, []), parse(rec, DEFAULT_RECORD));
        setRivals(parse(r, DEFAULT_RIVALS));
        setChallenges(resolved.challenges);
        setChallengeRecord(resolved.record);
        setRivalTaunts(parse<RivalTaunt[]>(t, []).slice(-20));
        if (resolved.changed) {
          await AsyncStorage.setItem(RIVAL_KEYS.CHALLENGES, JSON.stringify(resolved.challenges));
          await AsyncStorage.setItem(RIVAL_KEYS.CHALLENGE_RECORD, JSON.stringify(resolved.record));
        }
      } catch {
        // Keep the defaults.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Active challenges track the server score of their domain.
  useEffect(() => {
    if (!loaded || domainScores.length === 0) return;
    setChallenges((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.outcome !== null) return c;
        const score = domainScores.find((s) => s.domain === c.domain)?.score;
        if (score === undefined || score === c.userCurrentScore) return c;
        changed = true;
        return { ...c, userCurrentScore: score };
      });
      if (!changed) return prev;
      void AsyncStorage.setItem(RIVAL_KEYS.CHALLENGES, JSON.stringify(next));
      return next;
    });
  }, [domainScores, loaded]);

  const updateRivals = useCallback(async (next: Rival[]) => {
    await AsyncStorage.setItem(RIVAL_KEYS.RIVALS, JSON.stringify(next));
    setRivals(next);
    setChallenges((prev) => {
      const updated = prev.map((c) => {
        if (c.outcome !== null) return c;
        const rival = next.find((r) => r.codename === c.rivalCodename);
        return rival ? { ...c, rivalCurrentScore: rivalScore(rival, c.domain) } : c;
      });
      void AsyncStorage.setItem(RIVAL_KEYS.CHALLENGES, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const declareChallenge = useCallback(
    async (rivalCodename: string, rivalRank: Rank, domain: RivalDomain) => {
      const rival = rivals.find((r) => r.codename === rivalCodename);
      if (!rival) return;
      const userScore = domainScores.find((s) => s.domain === domain)?.score ?? 0;
      const start = today();
      const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
      const challenge: Challenge = {
        id: generateId(), rivalCodename, rivalRank, domain, startDate: start, endDate: end,
        userStartScore: userScore, rivalStartScore: rivalScore(rival, domain),
        userCurrentScore: userScore, rivalCurrentScore: rivalScore(rival, domain),
        outcome: null, acknowledged: false,
      };
      setChallenges((prev) => {
        const updated = [...prev, challenge];
        void AsyncStorage.setItem(RIVAL_KEYS.CHALLENGES, JSON.stringify(updated));
        return updated;
      });
    },
    [rivals, domainScores],
  );

  const updateChallengeScores = useCallback(async (next: Challenge[]) => {
    await AsyncStorage.setItem(RIVAL_KEYS.CHALLENGES, JSON.stringify(next));
    setChallenges(next);
  }, []);

  const acknowledgeChallenge = useCallback(async (challengeId: string) => {
    setChallenges((prev) => {
      const updated = prev.map((c) => (c.id === challengeId ? { ...c, acknowledged: true } : c));
      void AsyncStorage.setItem(RIVAL_KEYS.CHALLENGES, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resolveExpiredChallenges = useCallback(() => {
    setChallenges((prev) => {
      const resolved = resolveExpired(prev, challengeRecord);
      if (!resolved.changed) return prev;
      setChallengeRecord(resolved.record);
      void AsyncStorage.setItem(RIVAL_KEYS.CHALLENGES, JSON.stringify(resolved.challenges));
      void AsyncStorage.setItem(RIVAL_KEYS.CHALLENGE_RECORD, JSON.stringify(resolved.record));
      return resolved.challenges;
    });
  }, [challengeRecord]);

  const addRivalTaunt = useCallback(async (taunt: Omit<RivalTaunt, "id" | "generatedAt" | "read">) => {
    const entry: RivalTaunt = { ...taunt, id: generateId(), generatedAt: new Date().toISOString(), read: false };
    setRivalTaunts((prev) => {
      const updated = [...prev, entry].slice(-20);
      void AsyncStorage.setItem(RIVAL_KEYS.RIVAL_TAUNTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const markRivalTauntsRead = useCallback(async () => {
    setRivalTaunts((prev) => {
      const updated = prev.map((t) => ({ ...t, read: true }));
      void AsyncStorage.setItem(RIVAL_KEYS.RIVAL_TAUNTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return useMemo(
    () => ({
      rivals,
      challenges,
      challengeRecord,
      rivalTaunts,
      updateRivals,
      declareChallenge,
      updateChallengeScores,
      acknowledgeChallenge,
      resolveExpiredChallenges,
      addRivalTaunt,
      markRivalTauntsRead,
    }),
    [
      rivals, challenges, challengeRecord, rivalTaunts, updateRivals, declareChallenge, updateChallengeScores,
      acknowledgeChallenge, resolveExpiredChallenges, addRivalTaunt, markRivalTauntsRead,
    ],
  );
}
