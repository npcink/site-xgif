import assert from "node:assert/strict";
import test from "node:test";
import { diceSimilarity, parseFlomoHtml, parseFlomoZipData, readZipEntries } from "../flomo-import.js";

function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;

  for (const [name, value] of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(value, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + data.length;
  }

  const localData = Buffer.concat(locals);
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}

const exportHtml = `<!doctype html><html><body><div class="memos">
  <div class="memo"><div class="time">2026-07-20 10:20:30</div><div class="content"><p>一个足够短的标题</p><p>正文第一段&amp;补充。</p><p>https://jandan.net/t/6179471</p><p>#随笔</p></div><div class="files"></div></div>
  <div class="memo"><div class="time">2026-07-21 11:22:33</div><div class="content"><p>这是一个非常长而且不应该直接被当成标题的正文开头，因为它需要经过人工整理之后才能公开发布。</p><p>#待整理 #观察</p></div><div class="files"></div></div>
</div></body></html>`;

test("flomo HTML parser preserves dates and bodies while separating terminal tags", () => {
  const items = parseFlomoHtml(exportHtml);

  assert.equal(items.length, 2);
  assert.equal(items[0].pubDate, "2026-07-20");
  assert.deepEqual(items[0].tags, ["随笔"]);
  assert.match(items[0].body, /正文第一段&补充/);
  assert.doesNotMatch(items[0].body, /#随笔/);
  assert.doesNotMatch(items[0].body, /jandan\.net/);
  assert.equal(items[0].source, "煎蛋");
  assert.equal(items[0].sourceUrl, "https://jandan.net/t/6179471");
  assert.equal(items[0].sourceKind, "publication");
  assert.match(items[0].legacyContentHash, /^[a-f0-9]{64}$/);
  assert.equal(items[0].title, "一个足够短的标题");
  assert.equal(items[1].needsTitle, true);
  assert.deepEqual(items[1].tags, ["待整理", "观察"]);
});

test("flomo parser leaves genuinely ambiguous links in the body for review", () => {
  const html = `<!doctype html><html><body><div class="memo"><div class="time">2026-07-22 08:00:00</div><div class="content">
    <p>正文开头。</p><p>https://example.com/context</p><p>正文补充。</p><p>https://example.com/source</p>
  </div><div class="files"></div></div></body></html>`;
  const [item] = parseFlomoHtml(html);

  assert.equal(item.sourceUrl, "");
  assert.equal(item.sourceKind, "unknown");
  assert.equal(item.source, "来源待确认");
  assert.equal(item.needsSourceReview, true);
  assert.equal(item.needsReview, true);
  assert.match(item.body, /https:\/\/example\.com\/context/);
  assert.match(item.body, /https:\/\/example\.com\/source/);
});

test("flomo parser recognizes a source URL at the beginning of an article", () => {
  const html = `<!doctype html><html><body><div class="memo"><div class="time">2026-07-22 08:00:00</div><div class="content">
    <p>链接：https://www.zhihu.com/question/1/answer/2</p><p>来源：知乎</p><p>正文内容。</p>
  </div><div class="files"></div></div></body></html>`;
  const [item] = parseFlomoHtml(html);

  assert.equal(item.sourceUrl, "https://www.zhihu.com/question/1/answer/2");
  assert.equal(item.source, "知乎");
  assert.equal(item.sourceKind, "publication");
  assert.equal(item.needsSourceReview, false);
  assert.doesNotMatch(item.body, /question\/1/);
});

test("flomo parser removes list-style grouping tags from public content", () => {
  const html = `<!doctype html><html><body><div class="memo"><div class="time">2026-07-22 08:00:00</div><div class="content">
    <p>正文内容。</p><p>https://jandan.net/t/6086683</p><p>- #故事汇</p>
  </div><div class="files"></div></div></body></html>`;
  const [item] = parseFlomoHtml(html);

  assert.equal(item.sourceUrl, "https://jandan.net/t/6086683");
  assert.deepEqual(item.importTags, ["故事汇"]);
  assert.deepEqual(item.tags, []);
  assert.doesNotMatch(item.body, /故事汇|6086683/);
});

test("flomo parser rechecks terminal grouping tags after removing a later source link", () => {
  const html = `<!doctype html><html><body><div class="memo"><div class="time">2026-01-24 15:16:48</div><div class="content">
    <p>正文内容。</p><p>#sq</p><p>https://jandan.net/t/6086683</p>
  </div><div class="files"></div></div></body></html>`;
  const [item] = parseFlomoHtml(html);

  assert.equal(item.sourceUrl, "https://jandan.net/t/6086683");
  assert.deepEqual(item.importTags, ["sq"]);
  assert.deepEqual(item.tags, []);
  assert.doesNotMatch(item.body, /#sq|6086683/);
  assert.match(item.legacyContentHash, /^[a-f0-9]{64}$/);
});

test("flomo ZIP parser reads the exported HTML without extracting files", () => {
  const zip = storedZip([["flomo 导出.html", exportHtml]]);
  const dataUrl = `data:application/zip;base64,${zip.toString("base64")}`;
  const items = parseFlomoZipData(dataUrl);

  assert.equal(items.length, 2);
  assert.equal(items[0].recordedAt, "2026-07-20 10:20:30");
  assert.match(items[0].contentHash, /^[a-f0-9]{64}$/);
});

test("ZIP reader rejects path traversal even though imports stay in memory", () => {
  const zip = storedZip([["../memo.html", exportHtml]]);
  assert.throws(() => readZipEntries(zip), /不安全路径/);
});

test("semantic warning score tolerates small edits without treating unrelated text as equal", () => {
  assert.ok(diceSimilarity("这是一段准备发布的完整文章内容。", "这是一段准备公开发布的完整文章内容。") > 0.7);
  assert.ok(diceSimilarity("这是一段准备发布的完整文章内容。", "完全不同的话题和表达。") < 0.3);
});
