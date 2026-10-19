// Rebuild every daily rollup from raw heartbeats and token usage: `npm run backfill`.
// Run it after adding a new rollup (e.g. daily_hours) to fill in past days, or
// after changing prices in lib/usage.ts so past estimated spend is recalculated.
import { all, closeDb, tx } from "../lib/db.ts";
import { recomputeAiDay, recomputeDay } from "../lib/stats.ts";

const days = await all<{ user_id: number; local_date: string; timezone: string }>(
  `SELECT DISTINCT h.user_id, h.local_date, u.timezone
     FROM heartbeats h JOIN users u ON u.id = h.user_id`,
);
let done = 0;
for (const d of days) {
  await tx((q) => recomputeDay(q, d.user_id, d.local_date, d.timezone));
  if (++done % 500 === 0) console.log(`${done} / ${days.length} days`);
}
console.log(`Rebuilt ${days.length} user-days.`);

const aiDays = await all<{ user_id: number; local_date: string }>("SELECT DISTINCT user_id, local_date FROM ai_usage");
for (const d of aiDays) await tx((q) => recomputeAiDay(q, d.user_id, d.local_date));
console.log(`Rebuilt ${aiDays.length} user-days of AI usage.`);
await closeDb();
