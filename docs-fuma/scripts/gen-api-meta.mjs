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
    writeFileSync(file, `---\ntitle: "${esc(title)}"\n---\n\n${body}`);
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
for (const group of groups) {
  const items = (group.children ?? [])
    .map((id) => relByLowerName.get((nameById.get(id) ?? "").toLowerCase()))
    .filter(Boolean)
    .sort();
  if (items.length) pages.push(`---${group.title}---`, ...items);
}

writeFileSync(
  join(apiDir, "meta.json"),
  JSON.stringify({ title: "API Reference", pages }, null, 2) + "\n",
);
console.log(`API reference: ${relByLowerName.size} pages across ${groups.length} groups.`);
