function parseGitTree(output) {
  const blobs = new Map();
  for (const record of String(output || "").split("\0")) {
    if (!record) continue;
    const match = record.match(/^\d+\s+blob\s+([0-9a-f]+)\t([\s\S]+)$/u);
    if (match) blobs.set(match[2], match[1]);
  }
  return blobs;
}

export async function contentPathsMatchingRef({ paths, ref, runGit }) {
  const candidates = [...new Set(paths.map((value) => String(value || "")).filter(Boolean))];
  if (!candidates.length) return new Set();

  const [tree, working] = await Promise.all([
    runGit(["ls-tree", "-r", "-z", ref, "--", ...candidates]),
    runGit(["hash-object", "--", ...candidates]),
  ]);
  const refBlobs = parseGitTree(tree.stdout);
  const workingBlobs = String(working.stdout || "").trim().split(/\r?\n/u);
  if (workingBlobs.length !== candidates.length) {
    throw new Error("无法完整核对工作区内容与远程主分支。");
  }

  return new Set(candidates.filter((file, index) => refBlobs.get(file) === workingBlobs[index]));
}
