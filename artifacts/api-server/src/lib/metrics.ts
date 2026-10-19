import { timingSafeEqual, createHash } from "node:crypto";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/** One registry per process: the API and the worker each expose their own. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration by method, route pattern and status",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export type AiOutcome = "ok" | "error" | "timeout" | "invalid";

export const aiCalls = new Counter({
  name: "ai_calls_total",
  help: "Model calls by model and outcome",
  labelNames: ["model", "outcome"] as const,
  registers: [registry],
});

export const aiFallbacks = new Counter({
  name: "ai_fallbacks_total",
  help: "Times a templated fallback replaced model output",
  registers: [registry],
});

export const jobDuration = new Histogram({
  name: "job_duration_seconds",
  help: "Worker job duration (rollover, social, notifications)",
  labelNames: ["job"] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const rolloverUsers = new Counter({
  name: "rollover_users_total",
  help: "Users rolled over by the worker",
  registers: [registry],
});

/** Times `fn` into job_duration_seconds{job}, also when it throws. */
export async function timeJob<T>(job: "rollover" | "social" | "notifications", fn: () => Promise<T>): Promise<T> {
  const end = jobDuration.startTimer({ job });
  try {
    return await fn();
  } finally {
    end();
  }
}

/** Bearer check in constant time (both sides hashed so lengths do not leak). */
export function metricsAuthorized(header: string | undefined, token: string): boolean {
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}
