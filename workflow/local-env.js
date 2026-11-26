import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

export async function loadLocalEnv(directory, { env = process.env } = {}) {
  const envPath = path.join(directory, ".env");
  let source = "";
  try {
    source = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return env;
    throw error;
  }

  for (const [key, value] of Object.entries(parseEnv(source))) {
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}
