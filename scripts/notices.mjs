// Third-party notices: name, version, licence and the licence file text of every third-party package that ships.
// Plain ESM with no dependencies, so the API build (artifacts/api-server/build.mjs, also inside the Docker build) and
// the app's generator (artifacts/system-self/scripts/gen-notices.mjs) can both import it.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.[a-z0-9-]+)?$/i;

/** One package directory -> { name, version, license, homepage, dir, files: [{ name, text }] }, or null if not a package. */
export function readPackage(dir) {
  const manifest = path.join(dir, "package.json");
  if (!existsSync(manifest)) return null;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (!pkg.name || !pkg.version) return null;
  const files = readdirSync(dir)
    .filter((f) => LICENCE_FILE.test(f))
    .sort()
    .map((f) => ({ name: f, text: readFileSync(path.join(dir, f), "utf8").replace(/\r\n?/g, "\n").trimEnd() }));
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return { name: pkg.name, version: pkg.version, license: licenceOf(pkg), homepage: pkg.homepage ?? repo ?? "", dir, files };
}

function licenceOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (!l) return "UNKNOWN";
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x.type)).join(" OR ");
  return l.type ?? "UNKNOWN";
}

/**
 * Package directories of the production dependency graph of the package at `startDir`: its `dependencies`, plus the
 * installed `optionalDependencies` and `peerDependencies` (a peer is what the package runs against), recursively,
 * resolved through node_modules the way Node does (works with pnpm's symlinked layout, needs no store or network).
 * Workspace packages are walked through and dropped later. `rootDevDependencies` also starts from the root's
 * devDependencies: the Expo app keeps its runtime packages (expo, react-native, ...) there.
 */
export function prodDependencyDirs(startDir, { rootDevDependencies = false } = {}) {
  const seen = new Set();
  const out = [];
  const missing = [];
  const visit = (dir, required, isRoot = false) => {
    const real = realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    out.push(real);
    const pkg = JSON.parse(readFileSync(path.join(real, "package.json"), "utf8"));
    const deps = [
      ...Object.keys(pkg.dependencies ?? {}).map((n) => [n, true]),
      ...Object.keys(pkg.optionalDependencies ?? {}).map((n) => [n, false]),
      ...Object.keys(pkg.peerDependencies ?? {}).map((n) => [n, false]),
      ...(isRoot && rootDevDependencies ? Object.keys(pkg.devDependencies ?? {}).map((n) => [n, true]) : []),
    ];
    for (const [name, isRequired] of deps) {
      const found = resolveDependency(real, name);
      if (found) visit(found, isRequired);
      else if (isRequired && required) missing.push(`${name} (required by ${pkg.name})`);
    }
  };
  visit(startDir, true, true);
  if (missing.length) throw new Error(`Unresolved production dependencies (run pnpm install): ${missing.join(", ")}`);
  return out;
}

/** The directory `name` resolves to from package directory `fromDir`, or null. */
function resolveDependency(fromDir, name) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.basename(dir) === "node_modules" ? path.join(dir, name) : path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Package directories of every node_modules file an esbuild metafile says was bundled. */
export function bundledDependencyDirs(metafile, absWorkingDir) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const file = path.resolve(absWorkingDir, input.replace(/^[a-z-]+:/i, ""));
    const parts = file.split(path.sep);
    const nm = parts.lastIndexOf("node_modules");
    if (nm < 0) continue;
    const take = parts[nm + 1]?.startsWith("@") ? 3 : 2;
    dirs.add(parts.slice(0, nm + take).join(path.sep));
  }
  return [...dirs];
}

/** Reads, de-duplicates (name@version) and sorts packages, dropping the workspace's own (@workspace/*). */
export function collectPackages(dirs) {
  const byKey = new Map();
  for (const dir of dirs) {
    const p = readPackage(dir);
    if (!p || p.name.startsWith("@workspace/")) continue;
    const key = `${p.name}@${p.version}`;
    if (!byKey.has(key)) byKey.set(key, p);
  }
  return [...byKey.values()].sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

/** The full notices file: a summary table, then each package with its licence file text. */
export function renderNotices(title, packages) {
  const rule = "=".repeat(78);
  const head = [
    `THIRD-PARTY SOFTWARE NOTICES: ${title}`,
    "",
    `This product includes the following ${packages.length} third-party packages. Each is listed with its version,`,
    "its licence and the licence text it ships with. Generated from the lockfile-resolved dependency graph; do not",
    "edit by hand.",
    "",
    ...packages.map((p) => `  ${p.name}@${p.version}  (${p.license})`),
    "",
  ];
  const body = packages.map((p) =>
    [
      rule,
      `${p.name}@${p.version}`,
      `License: ${p.license}`,
      ...(p.homepage ? [`Source: ${p.homepage}`] : []),
      "",
      ...(p.files.length
        ? p.files.flatMap((f) => [`--- ${f.name} ---`, f.text, ""])
        : [`(The package ships no licence file; its package.json declares "${p.license}".)`, ""]),
    ].join("\n"),
  );
  return `${head.join("\n")}\n${body.join("\n")}`;
}

/** A compact Markdown list (name, version, licence) for small screens. */
export function renderCompactMarkdown(title, packages, fullFile) {
  const counts = new Map();
  for (const p of packages) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);
  const summary = [...counts].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} (${n})`).join(", ");
  return [
    `# Open-source licences`,
    "",
    `${title} is built with ${packages.length} open-source packages. Thank you to their authors.`,
    "",
    `Licences: ${summary}.`,
    "",
    `The full licence texts are in \`${fullFile}\`, shipped with the source.`,
    "",
    "## Packages",
    "",
    ...packages.map((p) => `- ${p.name} ${p.version}: ${p.license}`),
    "",
  ].join("\n");
}
