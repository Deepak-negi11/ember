import { ImageResponse } from "next/og";

// Share card for the site (X, LinkedIn, WhatsApp, Slack previews).
export const alt = "Ember: coding time tracker with a yearly heatmap and developer leaderboard";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEAT = ["#17181b", "#4a1806", "#8f2c07", "#e03e00", "#ff8152"];

export default function Image() {
  // A deterministic heat pattern, so the card looks the same on every render.
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cols = 40;
  const cells = Array.from({ length: cols * 4 }, () => {
    const r = rand();
    return r < 0.25 ? 0 : r < 0.45 ? 1 : r < 0.65 ? 2 : r < 0.85 ? 3 : 4;
  });
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "radial-gradient(70% 90% at 80% 10%, #2a1006 0%, #050505 60%)", color: "#f5f5f4", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 40, fontWeight: 600 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#ff4500", display: "flex" }} />
          ember
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>Proof you showed up,</div>
          <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>every single day.</div>
          <div style={{ fontSize: 30, color: "#a09e9b", marginTop: 8 }}>Coding time for VS Code, Cursor, Claude Code and Codex.</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", width: cols * 26, gap: 6 }}>
          {cells.map((l, i) => (
            <div key={i} style={{ width: 20, height: 20, borderRadius: 4, background: HEAT[l] }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
