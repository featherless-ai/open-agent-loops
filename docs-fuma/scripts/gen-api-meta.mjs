// Generates the API reference for the Fumadocs site:
//   1. Runs TypeDoc + typedoc-plugin-markdown → content/docs/api/**.md
//   2. Adds Fumadocs frontmatter (title) to each generated page.
//   3. Writes content/docs/api/meta.json with `@group`-based category groups,
//      using "---Label---" separators for the sidebar headings.
//
// Run from docs-fuma/:  npm run sidebar   (or: node scripts/gen-api-meta.mjs)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, ".."); // docs-fuma
const apiDir = join(root, "content", "docs", "api");
const jsonFile = join(root, ".api.json");

const GROUP_ORDER = [
  "Core",
  "Hooks & Gating",
  "Messages & Events",
  "Model",
  "Defining Tools",
  "Tool Registry",
  "Built-in Tools",
  "Stop Conditions",
  "Memory",
  "Permissions",
  "Credentials",
  "Composition",
  "Workflow",
  "Testing",
];

// TypeDoc kind folder → the `icon` slug written into each page's frontmatter;
// lib/source.tsx maps these to a small kind badge in the sidebar.
const KIND_BY_FOLDER = {
  classes: "class",
  interfaces: "interface",
  enumerations: "enum",
  "type-aliases": "type",
  functions: "function",
  variables: "variable",
};

// The five swappable loop seams, by exported name → seam category. Kept in sync
// with the loop diagram's palette (components/loop-diagram.tsx). A seam type's
// kind badge gets a ring in its seam color; the icon frontmatter encodes it as
// `<kind>:<seam>` (e.g. `interface:memory`).
const SEAM_BY_NAME = {
  Memory: "memory",
  ModelClient: "model",
  Tool: "tool",
  StopCondition: "stop",
  Hooks: "hook",
};

const bin = (args, opts = {}) =>
  execFileSync("bunx", args, { cwd: root, stdio: "inherit", ...opts });

// 1. Markdown reference (config in docs-fuma/typedoc.json).
bin(["typedoc"]);

// 2. Authoritative group → member mapping from TypeDoc's JSON model.
bin(["typedoc", "--entryPoints", "../agent-core/index.ts", "--tsconfig", "../tsconfig.json", "--excludeInternal", "--json", jsonFile], {
  stdio: ["ignore", "ignore", "inherit"],
});
const project = JSON.parse(readFileSync(jsonFile, "utf8"));
rmSync(jsonFile, { force: true });
const nameById = new Map();
for (const c of project.children ?? []) nameById.set(c.id, c.name);

// 3. Add frontmatter to every generated page; index map name → relative path.
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : [];
  });

const esc = (s) => s.replace(/"/g, '\\"');
const relByLowerName = new Map();
for (const file of walk(apiDir)) {
  const rel = relative(apiDir, file).replace(/\\/g, "/").replace(/\.md$/, "");
  const name = basename(file, ".md");
  const isIndex = rel === "index";
  const title = isIndex ? "API Reference" : name;

  let body = readFileSync(file, "utf8");
  if (!body.startsWith("---")) {
    body = body.replace(/^\s*# .*\n+/, ""); // drop leading H1 (now the frontmatter title)
    const fm = [`title: "${esc(title)}"`];
    const kind = isIndex ? null : KIND_BY_FOLDER[rel.split("/")[0]];
    if (kind) {
      const seam = SEAM_BY_NAME[name];
      fm.push(`icon: ${seam ? `${kind}:${seam}` : kind}`);
    }
    writeFileSync(file, `---\n${fm.join("\n")}\n---\n\n${body}`);
  }
  if (!isIndex) relByLowerName.set(name.toLowerCase(), rel);
}

// 4. Grouped meta.json with separator headings.
const rank = (t) => {
  const i = GROUP_ORDER.indexOf(t);
  return i === -1 ? GROUP_ORDER.length : i;
};
const groups = [...(project.groups ?? [])].sort((a, b) => rank(a.title) - rank(b.title));

const pages = ["index"];
const seen = new Set(["index"]); // a symbol re-exported (e.g. `export type {}`) can
// surface as two TypeDoc reflections with the same name → same page path; dedupe
// within each group and across groups so the sidebar never lists a page twice.
const isFunction = (p) => p.startsWith("functions/");
for (const group of groups) {
  const items = [
    ...new Set(
      (group.children ?? [])
        .map((id) => relByLowerName.get((nameById.get(id) ?? "").toLowerCase()))
        .filter(Boolean),
    ),
  ]
    .filter((p) => !seen.has(p))
    .sort();
  if (!items.length) continue;
  for (const p of items) seen.add(p);

  // Split each group into types (PascalCase: classes, interfaces, enums, type
  // aliases, variables) and functions (camelCase), under their own sub-headings.
  // A single-kind group reads fine under its heading alone, so only sub-label
  // when both kinds are present.
  pages.push(`---${group.title}---`);
  const fns = items.filter(isFunction);
  const types = items.filter((p) => !isFunction(p));
  if (fns.length && types.length) {
    pages.push("---Types---", ...types, "---Functions---", ...fns);
  } else {
    pages.push(...items);
  }
}

writeFileSync(
  join(apiDir, "meta.json"),
  JSON.stringify({ title: "API Reference", pages }, null, 2) + "\n",
);
console.log(`API reference: ${relByLowerName.size} pages across ${groups.length} groups.`);
