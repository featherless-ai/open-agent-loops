import { ImageResponse } from "next/og";

// Social-share card. Next.js serves this for og:image and twitter:image.
export const alt = "Open Agent Loops — a minimal, provider-agnostic agent loop";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        {/* the loop mark */}
        <svg width="96" height="96" viewBox="0 0 24 24" fill="none">
          <rect x="3.5" y="3.5" width="17" height="17" rx="6" stroke="#facc15" strokeWidth="2.6" />
          <circle cx="12" cy="3.5" r="3.2" fill="#facc15" />
        </svg>

        <div style={{ marginTop: 40, fontSize: 76, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Open Agent Loops
        </div>
        <div style={{ marginTop: 16, fontSize: 34, color: "#a1a1aa", maxWidth: 900 }}>
          A minimal, provider-agnostic agent loop. Every piece behind a swappable seam.
        </div>

        <div style={{ marginTop: 48, display: "flex", gap: 16, fontSize: 24, color: "#facc15" }}>
          <span>headless</span>
          <span style={{ color: "#3f3f46" }}>·</span>
          <span>streaming</span>
          <span style={{ color: "#3f3f46" }}>·</span>
          <span>one dependency</span>
          <span style={{ color: "#3f3f46" }}>·</span>
          <span>runs anywhere</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
