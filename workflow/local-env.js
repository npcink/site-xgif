import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadLocalEnv(directory, { env = process.env } = {}) {
  const envPath = path.join(directory, ".env");
  let source = "";
  try {
    source = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return env;
    throw error;
  }

  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || env[match[1]] !== undefined) continue;
    let value = match[2];
    const quoted = (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/u, "").trim();
    env[match[1]] = value;
  }
  return env;
}
