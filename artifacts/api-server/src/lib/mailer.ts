import { env, isDevOrTest, type Env } from "./env";
import { logger } from "./logger";

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export type MailerConfig = Pick<Env, "NODE_ENV" | "MAILER" | "RESEND_API_KEY" | "MAIL_FROM">;
type LogFn = (obj: Record<string, unknown>, msg: string) => void;

/** Replaces every 6-digit code with asterisks so codes never reach production logs. */
export function redactCodes(text: string): string {
  return text.replace(/\b\d{6}\b/g, "******");
}

export function createMailer(
  config: MailerConfig = env,
  log: LogFn = (obj, msg) => logger.info(obj, msg),
): Mailer {
  const apiKey = config.RESEND_API_KEY;
  if (config.MAILER === "log" || !apiKey) {
    // Env validation only allows this outside development/test when MAILER=log is set explicitly.
    const reveal = isDevOrTest(config.NODE_ENV);
    return {
      async send({ to, subject, text }) {
        log(
          { to, subject, text: reveal ? text : redactCodes(text) },
          reveal ? "mail (log mailer)" : "mail (log mailer; codes redacted)",
        );
      },
    };
  }
  return {
    async send({ to, subject, text }) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: config.MAIL_FROM, to, subject, text }),
      });
      if (!res.ok) {
        throw new Error(`Resend responded ${res.status}`);
      }
    },
  };
}
