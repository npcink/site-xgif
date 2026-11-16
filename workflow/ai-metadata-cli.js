import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadLocalEnv } from "./local-env.js";
import { providerConfig } from "./ai-metadata-provider.js";
import { collectMetadataInputs, generateMetadataRun, applyMetadataRun, rollbackMetadataRun, exportMetadataRun } from "./ai-metadata-runner.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  root: { type: "string", default: path.dirname(workflowRoot) },
  run: { type: "string" }, ids: { type: "string" }, fields: { type: "string", default: "all" },
  keep: { type: "string", default: "" }, frames: { type: "string", default: "12" },
  "max-calls": { type: "string", default: "24" }, gate: { type: "string" }, apply: { type: "boolean", default: false },
  help: { type: "boolean", default: false },
} });
const list = (text) => text ? text.split(",").map((s) => s.trim()).filter(Boolean) : [];
if (values.help || !positionals.length) {
  console.log(`AI metadata tools (local only; no publish)
  plan      --ids ID,... --fields title,summary,tags [--keep title]
  generate  --run NAME --ids ID,... --fields all --max-calls 12
  export    --run NAME
  apply     --run NAME [--ids ID,...] [--apply]
  rollback  --run NAME [--apply]
  --root points to a content checkout; --frames defaults to 12 per animation.
  More than 12 entries requires --gate from npcink-eval-lab.
  Generation/review providers use XGIF_AI_GENERATION_* and XGIF_AI_REVIEW_*.
  Default plan/apply/rollback are read-only. Only generate calls models.`);
} else {
  try {
    if (positionals.length !== 1) throw new Error("Specify exactly one command");
    const options = { repoRoot: path.resolve(values.root), runId: values.run, ids: list(values.ids), fields: list(values.fields),
      keep: list(values.keep), frames: Number(values.frames), maxCalls: Number(values["max-calls"]), apply: values.apply };
    const command = positionals[0]; let result;
    if (command === "plan") {
      const inputs = await collectMetadataInputs(options);
      result = { mode: "read-only", total: inputs.length, maxCallsNeeded: inputs.length * 2,
        items: inputs.map(({ id, fields, images, sourceHash }) => ({ id, fields, visualInputs: images.length, sourceHash })) };
    } else if (command === "generate") {
      if (values.apply) throw new Error("Generate never applies candidates");
      await loadLocalEnv(path.join(options.repoRoot, "workflow"));
      const generation = providerConfig(process.env, "generation");
      const review = providerConfig(process.env, "review", generation);
      result = await generateMetadataRun({ ...options, configs: { generation, review },
        gate: values.gate ? JSON.parse(await readFile(values.gate, "utf8")) : undefined,
        onProgress: (event) => console.error(JSON.stringify(event)),
      });
      // Do not print private source text / generated values into CLI logs.
      delete result.report;
      if (result.ready !== result.total) process.exitCode = 1;
    } else if (command === "export") {
      const report = await exportMetadataRun(options); result = { runId: options.runId, cases: report.cases.length };
    } else if (command === "apply") result = await applyMetadataRun(options);
    else if (command === "rollback") result = await rollbackMetadataRun(options);
    else throw new Error("Unknown command");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Avoid echoing provider responses or configuration containing credentials.
    let message = String(error.message);
    for (const [key, secret] of Object.entries(process.env)) if (/^XGIF_AI_.*API_KEY$/u.test(key) && secret) message = message.replaceAll(secret, "[redacted]");
    console.error(JSON.stringify({ ok: false, message })); process.exitCode = 1;
  }
}
