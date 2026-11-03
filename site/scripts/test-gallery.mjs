import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const created = [];
try {
  const images = [];
  for (let index = 1; index <= 3; index += 1) {
    const src = `/images/memes/xgif-gallery-test-${index}.svg`;
    const file = new URL(`public${src}`, root);
    await writeFile(file, `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${["#e9dec5", "#aec9bd", "#d4a694"][index - 1]}"/><circle cx="320" cy="220" r="120" fill="#213b3a"/><text x="320" y="265" fill="#fff" font-size="120" font-family="sans-serif" text-anchor="middle">${index}</text></svg>`, { flag: "wx" });
    created.push(file);
    images.push({ src, width: 640, height: 480 });
  }
  const content = new URL("src/content/images/20990101-gall.md", root);
  await writeFile(content, `---\ncontentId: "20990101-gall"\ntitle: "图集浏览验证"\ndescription: "三张图片共用一条内容。"\nimage: "${images[0].src}"\nimages: ${JSON.stringify(images)}\nwidth: 640\nheight: 480\nsource: "测试素材"\nsourceKind: "unknown"\ntags: ["生活"]\ncategory: "表情包"\npubDate: 2099-01-01\nratio: "wide"\npublic: true\ndraft: false\n---\n`, { flag: "wx" });
  created.push(content);
  const child = spawn("npm", ["run", "test:visual", "--", "image-gallery.behavior.spec.mjs"], {
    cwd: fileURLToPath(root), stdio: "inherit", env: { ...process.env, XGIF_GALLERY_FIXTURE: "true" },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); });
} finally {
  for (const file of created.reverse()) await unlink(file);
}
