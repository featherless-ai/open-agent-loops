// Generates a category-grouped sidebar for the API reference.
//
// Why this exists: starlight-typedoc builds its sidebar from output *directories*
// that match a group's slug, but typedoc-plugin-markdown writes files into
// reflection-*kind* folders (functions/, classes/, …). So `@group` groups never
// match a directory and get dropped. We sidestep that by deriving the sidebar
// ourselves: TypeDoc's JSON gives the authoritative group → members mapping
// (one group per symbol), and the generated markdown files give each member's
// page URL. The two are joined by name.
//
// Run from docs-site/:  bun run docs:sidebar
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsSite = join(here, "..");
const apiDir = join(docsSite, "src", "content", "docs", "api");
const outFile = join(docsSite, "src", "generated", "api-sidebar.json");
const jsonFile = join(docsSite, ".api.json");

// Order groups should appear in; anything else falls under the "*" bucket last.
const GROUP_ORDER = [
  "Core",
  "Messages & Events",
  "Model",
  "Tools",
  "Memory",
  "Stop Conditions",
  "Permissions",
  "Credentials",
  "Composition",
  "Workflow",
  "Testing",
];

// 1. Authoritative group membership from TypeDoc's JSON model.
execFileSync(
  "bunx",
  [
    "typedoc",
    "--entryPoints",
    "../agent-core/index.ts",
    "--tsconfig",
    "../tsconfig.json",
    "--excludeInternal",
    "--json",
    jsonFile,
  ],
  { cwd: docsSite, stdio: ["ignore", "ignore", "inherit"] },
);
const project = JSON.parse(readFileSync(jsonFile, "utf8"));
rmSync(jsonFile, { force: true });

const nameById = new Map();
for (const child of project.children ?? []) nameById.set(child.id, child.name);

// 2. Each generated page's URL, keyed by lowercased symbol name (Astro slugs
//    are lowercase). Files live at api/<kind>/<Name>.md → /api/<kind>/<name>/.
const urlByLowerName = new Map();
for (const kindFolder of readdirSync(apiDir, { withFileTypes: true })) {
  if (!kindFolder.isDirectory()) continue;
  for (const file of readdirSync(join(apiDir, kindFolder.name))) {
    if (!file.endsWith(".md")) continue;
    const name = basename(file, ".md");
    urlByLowerName.set(name.toLowerCase(), `/api/${kindFolder.name}/${name.toLowerCase()}/`);
  }
}

// 3. Join groups → members → URLs, preserving GROUP_ORDER then alphabetical.
const rank = (title) => {
  const i = GROUP_ORDER.indexOf(title);
  return i === -1 ? GROUP_ORDER.length : i;
};
const groups = [...(project.groups ?? [])].sort((a, b) => rank(a.title) - rank(b.title));

const sidebar = [];
for (const group of groups) {
  const items = [];
  for (const id of group.children ?? []) {
    const name = nameById.get(id);
    const link = name && urlByLowerName.get(name.toLowerCase());
    if (name && link) items.push({ label: name, link });
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  if (items.length) sidebar.push({ label: group.title, collapsed: true, items });
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(sidebar, null, 2) + "\n");
console.log(
  `Wrote ${outFile} — ${sidebar.length} groups, ${sidebar.reduce((n, g) => n + g.items.length, 0)} entries.`,
);
