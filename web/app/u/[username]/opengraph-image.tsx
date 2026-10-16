import { ImageResponse } from "next/og";
import { userByUsername } from "@/lib/auth.ts";
import { breakdown, dailySeries, rankOf, summary, todayFor } from "@/lib/stats.ts";
import { addDays, formatDuration, heatLevel } from "@/lib/time.ts";

// Personal share card: the profile's real recent heatmap and headline numbers.
export const alt = "Ember coding profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEAT = ["#17181b", "#4a1806", "#8f2c07", "#e03e00", "#ff8152"];
const WEEKS = 26;

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await userByUsername(username);
  if (!user) {
    return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#050505", color: "#f5f5f4", fontSize: 64 }}>ember</div>, size);
  }
  const today = todayFor(user.timezone);
  const [s, langs, rank, cells] = await Promise.all([
    summary(user.id, user.timezone),
    breakdown(user.id, "language", addDays(today, -29), today, 3),
    rankOf(user.id, 7),
    dailySeries(user.id, addDays(today, -(WEEKS * 7 - 1)), today),
  ]);
  const byDate = new Map(cells.map((c) => [c.date, c.seconds]));
  const grid: number[] = [];
  for (let i = WEEKS * 7 - 1; i >= 0; i--) grid.push(heatLevel(byDate.get(addDays(today, -i)) ?? 0));
  const initials = user.display_name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "radial-gradient(70% 90% at 85% 0%, #2a1006 0%, #050505 60%)", color: "#f5f5f4", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ width: 96, height: 96, borderRadius: 48, background: "linear-gradient(135deg, #ff8a45, #e03e00)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 700, color: "#fff" }}>{initials}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 52, fontWeight: 600, letterSpacing: -1 }}>{user.display_name}</div>
              <div style={{ display: "flex", fontSize: 28, color: "#a09e9b" }}>{`@${user.username}`}</div>
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: "#ff8152" }}>ember</div>
        </div>

        <div style={{ display: "flex", gap: 56 }}>
          {[
            ["Last 12 months", formatDuration(s.year)],
            s.streak.current >= 2
              ? ["Current streak", `${s.streak.current} days`]
              : ["Longest streak", `${s.streak.longest} ${s.streak.longest === 1 ? "day" : "days"}`],
            ["This week", rank ? `#${rank.rank} of ${rank.of}` : formatDuration(s.week)],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 22, color: "#817e7b", textTransform: "uppercase", letterSpacing: 2 }}>{label}</div>
              <div style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", flexWrap: "wrap", height: 7 * 22, width: WEEKS * 22, gap: 4 }}>
            {grid.map((l, i) => (
              <div key={i} style={{ width: 18, height: 18, borderRadius: 4, background: HEAT[l] }} />
            ))}
          </div>
          {langs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              {langs.map((l) => (
                <div key={l.name} style={{ display: "flex", fontSize: 26, color: "#d6d3d1" }}>{l.name}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
