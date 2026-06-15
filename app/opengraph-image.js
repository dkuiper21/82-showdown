import { ImageResponse } from "next/og";

// Branded preview card shown when 82-showdown.com is shared in messages,
// Slack/Discord, or on social. Next.js wires this up as og:image automatically.
export const runtime = "edge";
export const alt = "82 Showdown — Head-to-Head NBA Draft";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0d1321 0%, #1b2540 100%)",
          color: "#f5f7fb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", fontSize: 150, fontWeight: 800, letterSpacing: -4 }}>
          <span>82</span>
          <span style={{ color: "#ff7a00", marginLeft: 24 }}>SHOWDOWN</span>
        </div>
        <div style={{ marginTop: 28, fontSize: 40, color: "#aeb8d0", textAlign: "center", maxWidth: 900, display: "flex" }}>
          Draft 8 legends from random NBA seasons. Battle a friend in a best-of-7.
        </div>
      </div>
    ),
    { ...size }
  );
}
