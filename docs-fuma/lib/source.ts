import { docs } from "@/.source/server";
import { loader } from "fumadocs-core/source";

// Single source of truth for the docs tree (pages + sidebar) and lookups.
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
