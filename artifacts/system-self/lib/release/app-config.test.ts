import test from "node:test";
import assert from "node:assert/strict";
import { buildConfig } from "../../app.config";

const base = { name: "x", slug: "x", ios: { supportsTablet: false }, android: { versionCode: 1 } };

test("no env: placeholder id, no extra.eas, no googleServicesFile", () => {
  const c = buildConfig(base, {});
  assert.equal(c.ios?.bundleIdentifier, "com.systemself.app");
  assert.equal(c.android?.package, "com.systemself.app");
  assert.equal(c.extra?.eas, undefined);
  assert.equal(c.android?.googleServicesFile, undefined);
  assert.equal(c.android?.versionCode, 1);
});

test("env injects project id, app id and google services", () => {
  const c = buildConfig(base, { EAS_PROJECT_ID: "abc", APP_ID: "in.example.app", GOOGLE_SERVICES_JSON: "./g.json" });
  assert.equal(c.extra?.eas?.projectId, "abc");
  assert.equal(c.ios?.bundleIdentifier, "in.example.app");
  assert.equal(c.android?.package, "in.example.app");
  assert.equal(c.android?.googleServicesFile, "./g.json");
});

test("blank env values are treated as unset", () => {
  const c = buildConfig(base, { EAS_PROJECT_ID: " ", APP_ID: "" });
  assert.equal(c.extra?.eas, undefined);
  assert.equal(c.ios?.bundleIdentifier, "com.systemself.app");
});
