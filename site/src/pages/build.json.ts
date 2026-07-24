import { execFileSync } from "node:child_process";

export const prerender = true;

function gitCommit() {
  const fromEnvironment = [
    process.env.CF_PAGES_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.XGIF_BUILD_COMMIT,
  ].find(Boolean);
  if (fromEnvironment) return fromEnvironment.trim();

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: new URL("../../..", import.meta.url),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

export function GET() {
  return new Response(JSON.stringify({
    service: "xgif-site",
    commit: gitCommit(),
    builtAt: process.env.XGIF_BUILD_TIME || new Date().toISOString(),
  }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, must-revalidate",
    },
  });
}
