import { Router } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router = Router();

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
${rivalMovement ? `- Rival movement: ${rivalMovement}` : ""}`;

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
  };

  const config = typeConfigs[messageType] ?? typeConfigs["morning_briefing"];

  return {
    prompt: `${context}\n\nGenerate a ${messageType.replace(/_/g, " ")} for this user.\n${config.instruction}\nOutput only the message. No preamble. No explanation. Maximum ${config.maxWords} words.`,
    maxWords: config.maxWords,
  };
}

router.post("/system/message", async (req, res) => {
  try {
    const { prompt } = buildUserPrompt(req.body);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    const text = content.type === "text" ? content.text : "";

    res.json({
      message: text.trim(),
      messageType: req.body.messageType,
    });
  } catch (error) {
    req.log.error({ error }, "Failed to generate system message");
    res.status(500).json({ error: "Failed to generate message" });
  }
});

router.post("/system/quests", async (req, res) => {
  try {
    const {
      username,
      rank,
      domainScores,
      primaryGoal,
      weakestDomain,
      recentLogs,
    } = req.body;

    const prompt = `USER CONTEXT:
- Username: ${username}
- Rank: ${rank}
- Domain scores: BODY ${domainScores.BODY?.toFixed(1)}, MIND ${domainScores.MIND?.toFixed(1)}, WEALTH ${domainScores.WEALTH?.toFixed(1)}, DISCIPLINE ${domainScores.DISCIPLINE?.toFixed(1)}
- Primary goal: ${primaryGoal}
- Weakest domain: ${weakestDomain}
- Recent activity: ${recentLogs?.join(", ") || "no recent logs"}

Generate exactly 3 daily quests and 1 weekly quest for this user. Focus on the weakest domain but vary the domains.

Rules:
- Each quest title is under 10 words
- Each description is 1 sentence, specific, actionable
- Reference their actual weak domain data
- Do NOT use encouraging language
- Quests must be completable (daily = 1 day, weekly = 7 days)

Return ONLY valid JSON in this exact format:
{
  "quests": [
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "daily"},
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "daily"},
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "daily"},
    {"title": "...", "description": "...", "domain": "BODY|MIND|WEALTH|DISCIPLINE", "type": "weekly"}
  ]
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    const text = content.type === "text" ? content.text : "{}";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    res.json(parsed);
  } catch (error) {
    req.log.error({ error }, "Failed to generate quests");
    res.status(500).json({
      quests: [
        { title: "Log your workout", description: "Complete and log any physical activity today.", domain: "BODY", type: "daily" },
        { title: "Deep work session", description: "Complete one uninterrupted 90-minute focus session.", domain: "MIND", type: "daily" },
        { title: "Review expenses", description: "Categorize all uncategorized expenses from this week.", domain: "WEALTH", type: "daily" },
        { title: "Maintain your streak", description: "Log at least one entry per day for the next 7 days.", domain: "DISCIPLINE", type: "weekly" },
      ],
    });
  }
});

export default router;
