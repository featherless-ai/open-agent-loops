import { docs } from "@/.source/server";
import { loader } from "fumadocs-core/source";
import { kindIcon } from "@/components/kind-badge";

// Single source of truth for the docs tree (pages + sidebar) and lookups.
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  // API reference pages carry an `icon: class|interface|enum|type|function|variable`
  // frontmatter (written by scripts/gen-api-meta.mjs); render it as a kind badge.
  icon: kindIcon,
});
