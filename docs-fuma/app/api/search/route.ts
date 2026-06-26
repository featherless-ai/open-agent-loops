import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Full-text search index served to the client search dialog. `staticGET` (vs
// the dynamic `GET`) renders the whole index to a static JSON file at build
// time, so it works on a static host like GitHub Pages — the client fetches it
// once and searches in-browser (see the `type: "static"` config in layout.tsx).
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
