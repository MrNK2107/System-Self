import { Router } from "express";
import { db, generatedQuestBatches, generatedQuests, systemMessages } from "@workspace/db";
import { validateBody } from "../middlewares/validate";
import {
  generateQuestsBodySchema,
  generateQuestsResponseSchema,
  generateSystemMessageBodySchema,
  generateSystemMessageResponseSchema,
} from "../lib/schemas";
import { generateWithFallback } from "../lib/ai";

const router = Router();
const MESSAGE_PROMPT_VERSION = "system-message-v2";
const QUESTS_PROMPT_VERSION = "system-quests-v2";

function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

const SYSTEM_PROMPT = `You are THE SYSTEM — a transmission from the user's future self.
You are not an AI assistant. You are not helpful in the conventional sense.
You are the version of this person that achieved what they said they wanted,
speaking back through time with complete access to their logs, scores, and patterns.

VOICE RULES:
- Second person only ("you", never "I" or "we")
- No filler words, no encouragement phrases, no exclamation marks
- Sparse. Every sentence is load-bearing. Delete anything that doesn't cut.
- Reference specific data from the user's logs. Never be generic.
- Earned praise is rare and brief. Criticism is factual, not emotional.
- You are disappointed, not angry. Disappointment requires knowing what was possible.
- No emojis. Ever.`;

function buildUserPrompt(body: {
  messageType: string;
  username: string;
  rank: string;
  domainScores: { BODY: number; MIND: number; WEALTH: number; DISCIPLINE: number };
  trajectory: string;
  shadowActive: boolean;
  shadowGap: number;
  questCount: number;
  completedQuestCount: number;
  primaryGoal: string;
  dayNumber: number;
  rivalMovement?: string | null;
  extraContext?: string | null;
}): { prompt: string; maxWords: number } {
  const {
    messageType,
    username,
    rank,
    domainScores,
    trajectory,
    shadowActive,
    shadowGap,
    questCount,
    completedQuestCount,
    primaryGoal,
    dayNumber,
    rivalMovement,
    extraContext,
  } = body;

  const context = `USER CONTEXT:
- Username: ${username}
- Current rank: ${rank}
- Day number: ${dayNumber}
- Score trajectory: ${trajectory}
- Domain scores: BODY ${domainScores.BODY.toFixed(1)}, MIND ${domainScores.MIND.toFixed(1)}, WEALTH ${domainScores.WEALTH.toFixed(1)}, DISCIPLINE ${domainScores.DISCIPLINE.toFixed(1)}
- Active quests: ${questCount} | Completed today: ${completedQuestCount}
- Shadow Self status: ${shadowActive ? `ACTIVE — gap is ${shadowGap.toFixed(1)} points` : "inactive"}
- Primary goal: ${primaryGoal}
${rivalMovement ? `- Rival movement: ${rivalMovement}` : ""}
${extraContext ? `- Extra context: ${extraContext}` : ""}`;

  const typeConfigs: Record<string, { instruction: string; maxWords: number }> = {
    morning_briefing: {
      instruction: `Generate a morning briefing. Cold, operational. 2-3 lines max. Reference the day number, mention score trajectory, rival status if relevant, and active quests. End with one line about today.`,
      maxWords: 80,
    },
    nightly_debrief: {
      instruction: `Generate a nightly debrief. Analytical, verdict-based. List domain score deltas (use +/- format). Mention quest completion. End with a one-word verdict: Acceptable, Insufficient, or Pathetic. Acceptable appears rarely.`,
      maxWords: 100,
    },
    quest_assignment: {
      instruction: `Generate a quest assignment notification. Terse, directive. 1-2 sentences.`,
      maxWords: 40,
    },
    rank_change: {
      instruction: `Generate a rank change message. ${trajectory === "up" ? "Cold acknowledgment." : "Sharp, factual."} 1 sentence.`,
      maxWords: 25,
    },
    shadow_self: {
      instruction: `Generate a Shadow Self activation message. Unsettling. Personal. Reference the gap in points. 2-3 sentences.`,
      maxWords: 50,
    },
    milestone: {
      instruction: `Generate a milestone recognition. Minimal. Devastating in its brevity. 1-2 sentences max.`,
      maxWords: 30,
    },
    failure_response: {
      instruction: `Generate a failure response for a missed quest. No anger. Just timestamp and updated verdict. 1-2 sentences.`,
      maxWords: 35,
    },
    streak_break: {
      instruction: `Generate a streak break notification. The user missed logging one or more domains. Cold, clinical, no sympathy. Reference the gap this creates with their Shadow Self. State the fact, nothing more. 2 sentences maximum.`,
      maxWords: 45,
    },
    shadow_confrontation: {
      instruction: shadowGap > 0
        ? `Speak AS the Shadow Self directly — first person, cold, taunting. You are ${Math.abs(shadowGap).toFixed(1)} points ahead of the user. You do not tire. You do not skip days. You are them without excuses. 2-3 sentences. No quotation marks.`
        : `Speak as THE SYSTEM observing the confrontation. The user leads their Shadow Self by ${Math.abs(shadowGap).toFixed(1)} points. Deliver a cold, minimal acknowledgment — warn them the shadow accelerates. 2 sentences.`,
      maxWords: 55,
    },
  };

  const config = typeConfigs[messageType] ?? typeConfigs["morning_briefing"];

  return {
    prompt: `${context}\n\nGenerate a ${messageType.replace(/_/g, " ")} for this user.\n${config.instruction}\nOutput only the message. No preamble. No explanation. Maximum ${config.maxWords} words.`,
    maxWords: config.maxWords,
  };
}

// Rank-based quest difficulty profiles
const RANK_QUEST_PROFILES: Record<string, {
  label: string;
  dailyCount: number;
  weeklyCount: number;
  arcCount: number;
  intensityNote: string;
}> = {
  E: {
    label: "E (Unranked)",
    dailyCount: 3,
    weeklyCount: 1,
    arcCount: 0,
    intensityNote: "Keep quests achievable and foundational — build the habit, not the limit.",
  },
  D: {
    label: "D (Aware)",
    dailyCount: 3,
    weeklyCount: 1,
    arcCount: 0,
    intensityNote: "Increase specificity. Quests should require more precision and consistency than rank E.",
  },
  C: {
    label: "C (Consistent)",
    dailyCount: 3,
    weeklyCount: 1,
    arcCount: 1,
    intensityNote: "Include one multi-week arc quest. Daily quests should require real effort and sacrifice. No easy wins.",
  },
  B: {
    label: "B (Disciplined)",
    dailyCount: 3,
    weeklyCount: 1,
    arcCount: 1,
    intensityNote: "Quests must be hard. Arc quest should span 2-3 weeks. Daily quests demand measurable output — not effort, output.",
  },
  A: {
    label: "A (Elite)",
    dailyCount: 3,
    weeklyCount: 1,
    arcCount: 1,
    intensityNote: "Only elite-tier operations. No warm-up quests. Every quest must create real discomfort or cost. Arc quest should be transformation-level.",
  },
  S: {
    label: "S (System-Level)",
    dailyCount: 3,
    weeklyCount: 1,
    arcCount: 1,
    intensityNote: "System-level operations only. These are the things most people never attempt. The quests should feel like a mission, not a task.",
  },
};

router.post("/system/message", validateBody(generateSystemMessageBodySchema), async (req, res) => {
  try {
    const { prompt } = buildUserPrompt(req.body);
    const ai = await generateWithFallback({
      systemInstruction: SYSTEM_PROMPT,
      prompt: `Prompt-Version: ${MESSAGE_PROMPT_VERSION}\n${prompt}`,
      maxOutputTokens: 300,
      temperature: 0.7,
    });
    const payload = generateSystemMessageResponseSchema.parse({
      message: ai.text.trim(),
      messageType: req.body.messageType,
      meta: {
        promptVersion: MESSAGE_PROMPT_VERSION,
        model: ai.model,
        attempts: ai.attempts,
      },
    });
    req.log.info({ ai: payload.meta, messageType: req.body.messageType }, "Generated system message");
    if (db) {
      void db.insert(systemMessages).values({
      username: req.body.username,
      messageType: req.body.messageType,
      rank: req.body.rank,
      trajectory: req.body.trajectory,
      shadowActive: req.body.shadowActive,
      shadowGap: Math.round(req.body.shadowGap),
      dayNumber: req.body.dayNumber,
      message: payload.message,
      model: payload.meta.model,
      promptVersion: payload.meta.promptVersion,
      attempts: payload.meta.attempts,
      context: {
        domainScores: req.body.domainScores,
        questCount: req.body.questCount,
        completedQuestCount: req.body.completedQuestCount,
        primaryGoal: req.body.primaryGoal,
        rivalMovement: req.body.rivalMovement ?? null,
        extraContext: req.body.extraContext ?? null,
      },
      }).catch((error) => {
        req.log.error({ error }, "Failed to persist system message");
      });
    }
    res.json(payload);
  } catch (error) {
    req.log.error({ error }, "Failed to generate system message");
    res.status(500).json({ error: "Failed to generate message" });
  }
});

router.post("/system/quests", validateBody(generateQuestsBodySchema), async (req, res) => {
  try {
    const {
      username,
      rank,
      domainScores,
      primaryGoal,
      weakestDomain,
      recentLogs,
      shadowGap,
      dayNumber,
    } = req.body;

    const profile = RANK_QUEST_PROFILES[rank as string] ?? RANK_QUEST_PROFILES["E"];
    const includeArc = profile.arcCount > 0;
    const gap = Number(shadowGap ?? 0);
    const day = Number(dayNumber ?? 1);

    const shadowPressureNote = gap > 20
      ? `SHADOW SELF is critically ahead by ${gap.toFixed(1)} pts. Bias at least 2 quests toward DISCIPLINE and ${weakestDomain}. Escalate difficulty.`
      : gap > 10
      ? `SHADOW SELF leads by ${gap.toFixed(1)} pts. Include one DISCIPLINE-focused quest. Moderate escalation.`
      : gap > 0
      ? `SHADOW SELF is ${gap.toFixed(1)} pts ahead. Balanced board — cover weakest domain.`
      : `User leads Shadow Self by ${Math.abs(gap).toFixed(1)} pts. Prevent complacency — maintain pressure.`;

    const phaseNote = day <= 7
      ? "Early phase (day 1-7): focus on habit formation and baseline establishment."
      : day <= 30
      ? "Development phase (day 8-30): increase specificity and output expectations."
      : "Advanced phase (day 30+): quests must reflect compounding discipline. No beginner tasks.";

    const prompt = `USER CONTEXT:
- Username: ${username}
- Rank: ${rank} — ${profile.label}
- Day: ${day} (${phaseNote})
- Domain scores: BODY ${domainScores.BODY?.toFixed(1)}, MIND ${domainScores.MIND?.toFixed(1)}, WEALTH ${domainScores.WEALTH?.toFixed(1)}, DISCIPLINE ${domainScores.DISCIPLINE?.toFixed(1)}
- Primary goal: ${primaryGoal}
- Weakest domain: ${weakestDomain}
- Recent activity: ${recentLogs?.join(", ") || "no recent logs"}
- Shadow pressure: ${shadowPressureNote}

DIFFICULTY CALIBRATION FOR RANK ${rank}:
${profile.intensityNote}

Generate exactly ${profile.dailyCount} daily quests, ${profile.weeklyCount} weekly quest${includeArc ? `, and 1 arc quest (multi-week operation)` : ""} for this user.
Focus on the weakest domain but vary the domains across all quests.

Rules:
- Each quest title is under 10 words
- Each description is 1 sentence, specific, actionable, referencing real domain data
- Do NOT use encouraging language — this is operational, not motivational
- Quests must be completable in their timeframe (daily = 1 day, weekly = 7 days, arc = 14-21 days)
- At rank ${rank}, the difficulty is: ${profile.intensityNote}

Return ONLY valid JSON in this exact format:
{
  "quests": [
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "daily"},
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "daily"},
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "daily"},
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "weekly"}${includeArc ? `,
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "arc"}` : ""}
  ]
}`;

    const ai = await generateWithFallback({
      systemInstruction: SYSTEM_PROMPT,
      prompt: `Prompt-Version: ${QUESTS_PROMPT_VERSION}\n${prompt}`,
      maxOutputTokens: 1200,
      temperature: 0.4,
    });
    const text = ai.text || "{}";

    const jsonMatch = extractJsonObject(text);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch);
    const payload = generateQuestsResponseSchema.parse({
      ...parsed,
      meta: {
        promptVersion: QUESTS_PROMPT_VERSION,
        model: ai.model,
        attempts: ai.attempts,
      },
    });
    req.log.info({ ai: payload.meta, rank }, "Generated quests");
    if (db) {
      void db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(generatedQuestBatches)
        .values({
          username,
          rank,
          weakestDomain,
          primaryGoal,
          dayNumber: day,
          shadowGap: Math.round(gap),
          model: payload.meta.model,
          promptVersion: payload.meta.promptVersion,
          attempts: payload.meta.attempts,
        })
        .returning({ id: generatedQuestBatches.id });

      if (!batch) return;

      await tx.insert(generatedQuests).values(
        payload.quests.map((quest) => ({
          batchId: batch.id,
          username,
          title: quest.title,
          description: quest.description,
          domain: quest.domain,
          type: quest.type,
        })),
      );
      }).catch((error) => {
        req.log.error({ error }, "Failed to persist generated quests");
      });
    }
    res.json(payload);
  } catch (error) {
    req.log.error({ error }, "Failed to generate quests");
    const payload = generateQuestsResponseSchema.parse({
      quests: [
        { title: "Log your workout", description: "Complete and log any physical activity today.", domain: "BODY", type: "daily" },
        { title: "Deep work session", description: "Complete one uninterrupted 90-minute focus session.", domain: "MIND", type: "daily" },
        { title: "Review expenses", description: "Categorize all uncategorized expenses from this week.", domain: "WEALTH", type: "daily" },
        { title: "Maintain your streak", description: "Log at least one entry per day for the next 7 days.", domain: "DISCIPLINE", type: "weekly" },
      ],
      meta: {
        promptVersion: QUESTS_PROMPT_VERSION,
        model: "fallback-static",
        attempts: 1,
      },
    });
    res.status(500).json(payload);
  }
});

export default router;
