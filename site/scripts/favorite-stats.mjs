import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const days = Number(process.argv[2] || 30);
if (process.argv.length > 3 || !Number.isInteger(days) || days < 1 || days > 366) {
  console.error("Usage: npm run stats:favorites -- [1–366 days, default 30]");
  process.exit(1);
}
const sql = `SELECT day AS utc_day, kind, content_id, adds AS favorite_actions, removes AS remove_actions
  FROM favorite_daily WHERE day >= date('now', '-${days - 1} days') ORDER BY day DESC, adds DESC, content_id`;
const result = spawnSync(fileURLToPath(new URL("../node_modules/.bin/wrangler", import.meta.url)), [
  "d1", "execute", "xgif-engagement", "--remote", "--json", "--command", sql,
], { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit" });
process.exitCode = result.status ?? 1;
