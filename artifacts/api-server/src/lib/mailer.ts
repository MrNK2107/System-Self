import { env } from "./env";
import { logger } from "./logger";

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export function createMailer(): Mailer {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      async send({ to, subject, text }) {
        logger.info({ to, subject, text }, "mail (log mailer; RESEND_API_KEY not set)");
      },
    };
  }
  return {
    async send({ to, subject, text }) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
      });
      if (!res.ok) {
        throw new Error(`Resend responded ${res.status}`);
      }
    },
  };
}
