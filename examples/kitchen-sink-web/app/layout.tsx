import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Agent Loops",
  description:
    "Kitchen-sink chat UI for an Open Agent Loops agent, streamed to assistant-ui.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <div className="flex h-screen flex-col">
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </body>
    </html>
  );
}
