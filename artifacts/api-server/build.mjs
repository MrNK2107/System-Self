import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

/** Not bundled. @node-rs/argon2 is native; the rest are optional native add-ons (absent at runtime is fine). */
export const RUNTIME_EXTERNALS = ["*.node", "@node-rs/*", "pg-native", "bufferutil", "utf-8-validate"];

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: {
      index: path.resolve(artifactDir, "src/index.ts"),
      worker: path.resolve(artifactDir, "src/worker.ts"),
      // The migrator runs in the image without tsx; migrations sit next to it (dist/migrations).
      migrate: path.resolve(artifactDir, "../../lib/db/src/migrate.ts"),
    },
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Every pure-JS runtime dependency is bundled, so the image ships almost no node_modules (see Dockerfile).
    // RUNTIME_EXTERNALS lists the only packages that stay external: native addons (loaded per platform at runtime)
    // and optional native accelerators that are require()d inside try/catch. The Dockerfile installs exactly these.
    external: RUNTIME_EXTERNALS,
    sourcemap: "linked",
    // Third-party licence notices (/*! ... */, @license, @preserve) go to dist/<entry>.mjs.LEGAL.txt, which the
    // Dockerfile keeps in the image; the bundles link to them.
    legalComments: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await cp(path.resolve(artifactDir, "../../lib/db/migrations"), path.resolve(distDir, "migrations"), { recursive: true });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
