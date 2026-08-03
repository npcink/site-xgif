import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_PATTERN_EXAMPLES,
  CONTENT_PATTERNS,
  inspectContentPatterns,
} from "./content-patterns.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesOnly = process.argv.includes("--examples");

function verifyExamples() {
  return CONTENT_PATTERN_EXAMPLES.map((example) => {
    const actual = CONTENT_PATTERNS[example.rule].test(example.input);
    return { ...example, actual, ok: actual === example.matches };
  });
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(filePath);
    return /\.mdx?$/iu.test(entry.name) ? [filePath] : [];
  }));
  return nested.flat();
}

const examples = verifyExamples();
if (examples.some((example) => !example.ok)) {
  console.error(JSON.stringify({ ok: false, examples }, null, 2));
  process.exitCode = 1;
} else if (examplesOnly) {
  console.log(JSON.stringify({ ok: true, examples }, null, 2));
} else {
  const roots = [
    path.join(repoRoot, "site", "src", "content", "articles"),
    path.join(repoRoot, "site", "src", "content", "images"),
  ];
  const files = (await Promise.all(roots.map(markdownFiles))).flat().sort();
  const findings = [];
  for (const filePath of files) {
    const report = inspectContentPatterns(await readFile(filePath, "utf8"));
    if (!report.trailingWhitespaceLines.length && !report.excessiveBlankLineRuns) continue;
    findings.push({
      file: path.relative(repoRoot, filePath),
      trailingWhitespaceLines: report.trailingWhitespaceLines,
      excessiveBlankLineRuns: report.excessiveBlankLineRuns,
    });
  }
  console.log(JSON.stringify({
    ok: findings.length === 0,
    mode: "dry-run",
    scanned: files.length,
    changed: 0,
    findings,
    examples,
  }, null, 2));
}
