// Rebuild every daily rollup from raw heartbeats: `npm run backfill`.
// Run it after adding a new rollup (e.g. daily_hours) to fill in past days.
import { all, closeDb, tx } from "../lib/db.ts";
import { recomputeDay } from "../lib/stats.ts";

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
await closeDb();
