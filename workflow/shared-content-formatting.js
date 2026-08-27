// Keep XGIF's workflow on the shared Workbench formatting implementation.
// The sibling path is configurable for deployments outside this workspace.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workbenchRoot = process.env.LOCAL_CONTENT_WORKBENCH_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../local-content-workbench");
const shared = await import(pathToFileURL(path.join(workbenchRoot, "src/content/text-formatting.mjs")).href);

export const normalizeCjkSpacing = shared.normalizeCjkSpacing;
export const organizeMarkdownParagraphs = shared.organizeMarkdownParagraphs;
