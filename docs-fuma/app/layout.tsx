import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";

// On a static host the search index is a build-time JSON file, fetched by the
// client. The basePath isn't auto-applied to a raw fetch (unlike <Link>), so we
// prefix it explicitly — same NEXT_PUBLIC_BASE_PATH that next.config.mjs uses.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Absolute base for OG/Twitter image URLs. Set to the Pages origin in CI; falls
// back to localhost for local builds (where social cards don't matter).
export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  ),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          theme={{ defaultTheme: "dark", enableSystem: false }}
          search={{
            options: { type: "static", api: `${basePath}/api/search` },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
