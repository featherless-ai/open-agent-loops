import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "assistant-ui with Assistant Transport",
  description:
    "An example of using assistant-ui with the assistant-transport runtime",
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
