// Generates the app's third-party notices from its installed dependency graph (the app's dependencies and
// devDependencies, where Expo keeps the runtime packages, then their production and peer dependencies):
//   docs/legal/THIRD_PARTY_NOTICES-app.txt  every package with its licence text (ships with the source)
//   docs/legal/open-source-licences.md      a compact name/version/licence list, bundled into the app by gen-legal
// then re-runs gen-legal so the in-app "Open-source licences" document matches. lib/legal/documents.test.ts fails if
// the files drift from the dependencies. Run `pnpm run gen:notices` after changing app dependencies.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collectPackages, prodDependencyDirs, renderCompactMarkdown, renderNotices } from "../../../scripts/notices.mjs";

const legal = new URL("../../../docs/legal/", import.meta.url);

const packages = collectPackages(prodDependencyDirs(fileURLToPath(new URL("../", import.meta.url)), { rootDevDependencies: true }));
writeFileSync(new URL("THIRD_PARTY_NOTICES-app.txt", legal), renderNotices("SYSTEM // SELF mobile app", packages));
writeFileSync(
  new URL("open-source-licences.md", legal),
  renderCompactMarkdown("SYSTEM // SELF", packages, "docs/legal/THIRD_PARTY_NOTICES-app.txt"),
);
console.log(`wrote docs/legal/THIRD_PARTY_NOTICES-app.txt and docs/legal/open-source-licences.md (${packages.length} packages)`);
await import("./gen-legal.mjs");
