import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Full-text search index served to the client search dialog.
export const { GET } = createFromSource(source);
