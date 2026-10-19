import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      issues: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  // body-parser errors carry a type and a 4xx status: answer them as JSON, never as a 500.
  const type = (err as { type?: unknown } | null)?.type;
  if (type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large", code: "payload_too_large" });
  }
  if (type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body", code: "invalid_json" });
  }
  const status = (err as { status?: unknown; expose?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500 && (err as { expose?: unknown }).expose === true) {
    return res.status(status).json({ error: "Bad request", code: "bad_request" });
  }

  req.log.error({ err }, "Unhandled API error");
  return res.status(500).json({ error: "Internal server error" });
}
