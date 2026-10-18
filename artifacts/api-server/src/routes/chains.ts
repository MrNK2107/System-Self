import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { profiles, questChains, type Db } from "@workspace/db";
import { CHAIN_TEMPLATES, chainStepQuest, findChainTemplate } from "@workspace/engine";
import { ChainStartRequestSchema } from "@workspace/contracts";
import { withIdempotency } from "../services/idempotency";
import { rollOverBeforeToday } from "../services/rollover";
import { createQuests, toQuestDto } from "../services/quests";
import { CHAIN_STEP_EXPIRY_MS } from "./quests";

export function chainsRoutes(db: Db): IRouter {
  const router = Router();

  router.get("/chains/templates", async (req, res) => {
    const active = await db
      .select({ templateKey: questChains.templateKey, currentStep: questChains.currentStep })
      .from(questChains)
      .where(and(eq(questChains.userId, req.user!.id), eq(questChains.status, "active")));
    res.json({
      templates: CHAIN_TEMPLATES.map((t) => ({
        templateKey: t.templateKey,
        name: t.name,
        description: t.description,
        domain: t.domain,
        steps: t.steps,
      })),
      active,
    });
  });

  router.post("/chains", async (req, res) => {
    const body = ChainStartRequestSchema.parse(req.body);
    const userId = req.user!.id;
    await withIdempotency(db, req, res, "POST /chains", async (tx) => {
      const now = new Date();
      await rollOverBeforeToday(tx, userId, now); // roll every date before today before this write lands
      const template = findChainTemplate(body.templateKey)!;
      const [profile] = await tx.select({ id: profiles.userId }).from(profiles).where(eq(profiles.userId, userId));
      if (!profile) return { status: 409, body: { error: "Not onboarded", code: "not_onboarded" } };
      const [existing] = await tx
        .select({ id: questChains.id })
        .from(questChains)
        .where(
          and(
            eq(questChains.userId, userId),
            eq(questChains.templateKey, template.templateKey),
            eq(questChains.status, "active"),
          ),
        )
        .limit(1);
      if (existing) return { status: 409, body: { error: "Chain already active", code: "chain_active" } };

      const [chain] = await tx
        .insert(questChains)
        .values({
          userId,
          templateKey: template.templateKey,
          name: template.name,
          domain: template.domain,
          currentStep: 0,
          totalSteps: template.steps.length,
          startedAt: now,
        })
        .returning();
      const [quest] = await createQuests(tx, userId, [
        {
          ...chainStepQuest(template.templateKey, 0),
          expiresAt: new Date(now.getTime() + CHAIN_STEP_EXPIRY_MS),
          chainId: chain!.id,
          chainStep: 0,
          chainTotal: template.steps.length,
        },
      ]);
      return {
        status: 201,
        body: {
          chain: {
            id: chain!.id,
            templateKey: chain!.templateKey,
            name: chain!.name,
            domain: chain!.domain,
            currentStep: chain!.currentStep,
            totalSteps: chain!.totalSteps,
            status: chain!.status,
            startedAt: chain!.startedAt.toISOString(),
          },
          quest: toQuestDto(quest!),
        },
      };
    });
  });

  return router;
}
