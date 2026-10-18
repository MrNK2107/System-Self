import test from "node:test";
import assert from "node:assert/strict";
import { createMailer, type MailerConfig } from "./mailer";

const MSG = { to: "a@x.io", subject: "Reset", text: "Your password reset code is 042917. It expires in 15 minutes." };

function capture(config: MailerConfig) {
  const lines: Array<Record<string, unknown>> = [];
  const mailer = createMailer(config, (obj) => lines.push(obj));
  return { mailer, lines };
}

test("log mailer redacts 6-digit codes in production", async () => {
  const { mailer, lines } = capture({ NODE_ENV: "production", MAILER: "log", MAIL_FROM: "x" });
  await mailer.send(MSG);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.text, "Your password reset code is ******. It expires in 15 minutes.");
  assert.ok(!JSON.stringify(lines).includes("042917"));
});

test("log mailer redacts when NODE_ENV is unset", async () => {
  const { mailer, lines } = capture({ NODE_ENV: undefined, MAILER: "log", MAIL_FROM: "x" });
  await mailer.send(MSG);
  assert.equal(lines.length, 1);
  assert.ok(!JSON.stringify(lines).includes("042917"));
});

test("log mailer shows codes in development and test", async () => {
  for (const NODE_ENV of ["development", "test"] as const) {
    const { mailer, lines } = capture({ NODE_ENV, MAIL_FROM: "x" });
    await mailer.send(MSG);
    assert.equal(lines[0]!.text, MSG.text);
  }
});
