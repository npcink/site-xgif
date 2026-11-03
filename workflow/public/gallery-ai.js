const FIELDS = ["title", "description", "tags", "category", "mood", "scenes"];

export function createGalleryAi({ root, api, gallery, context, onChange }) {
  const status = root.querySelector("#image-ai-availability");
  const issues = root.querySelector("#image-ai-issues");
  const retry = root.querySelector('[data-ai-fill="image"]');
  const cover = root.querySelector("#image-ai-cover");
  let config = null;
  let job = null;
  let signature = "";
  let scope = context();
  let epoch = 0;
  let timer;
  let applied = "";
  let lastValues = {};
  let protectedFields = new Set();
  let halted = false;
  let failureMessage = "";
  let locked = false;
  const currentSignature = () => JSON.stringify(gallery.snapshot().map((image) => image.src));
  const current = (generation) => generation === epoch && scope === context() && signature === currentSignature();
  const busy = () => job && ["queued", "running", "summarizing"].includes(job.state);

  function render() {
    retry.disabled = locked || !gallery.ready() || Boolean(busy());
    retry.textContent = busy() ? "正在整理…" : job?.state === "done" ? "重新汇总" : "继续整理 / 重试";
    cover.hidden = !job?.summary?.coverSrc || job.summary.coverSrc === gallery.snapshot()[0]?.src;
    cover.disabled = locked;
    issues.replaceChildren();
    if (!gallery.snapshot().length) { status.textContent = "上传后自动逐张识别并整理图集资料。"; return; }
    if (!config?.available) status.textContent = config?.configurationError || "M4 图集 AI 尚未配置，图片已保留，可手动整理。";
    else if (!gallery.ready()) status.textContent = "图片全部上传后开始自动整理。";
    else if (job) {
      const done = job.items.filter((item) => item.state === "done").length;
      status.textContent = halted ? "暂时无法读取 M4 进度，已保留任务，点击继续整理即可恢复。"
        : job.state === "paused" ? `已识别 ${done} / ${job.items.length} 张，连接中断，已保留进度；点击继续整理恢复。`
        : job.state === "done" ? `已整理 ${done} / ${job.items.length} 张，请预览确认。`
        : job.state === "summarizing" ? `已识别 ${done} / ${job.items.length} 张，正在汇总图集…`
        : `已识别 ${done} / ${job.items.length} 张${job.state === "attention" ? "，部分项目需要检查或重试。" : "，后台整理中…"}`;
    } else status.textContent = halted ? `${failureMessage || "M4 暂时无法连接"} 图片与资料已保留，可重试或手动整理。` : "正在准备图集整理任务…";
    for (const [index, item] of (job?.items || []).entries()) {
      const warnings = item.state === "error" ? [item.error] : item.result?.warnings || [];
      if (!warnings.length) continue;
      const row = document.createElement("div");
      const message = document.createElement("span");
      message.textContent = `第 ${index + 1} 张：${warnings.join("；")}`;
      const inspect = document.createElement("button");
      inspect.type = "button"; inspect.textContent = "查看图片";
      inspect.addEventListener("click", () => gallery.select(item.src));
      row.append(message, inspect);
      if (item.state === "error") {
        const button = document.createElement("button");
        button.type = "button"; button.textContent = "重试此图"; button.disabled = locked || Boolean(busy());
        button.addEventListener("click", () => restart([item.sha256]));
        row.append(button);
      }
      issues.append(row);
    }
    for (const warning of [...(job?.summary?.warnings || []), job?.error].filter(Boolean)) {
      const row = document.createElement("p"); row.textContent = warning; issues.append(row);
    }
  }

  function apply() {
    if (locked) return;
    gallery.setAnalysis(job);
    if (!job?.summary) return;
    const key = `${job.id}:${JSON.stringify(job.summary)}`;
    if (key === applied) return;
    applied = key;
    for (const field of FIELDS) {
      const input = root.elements.namedItem(field);
      if (protectedFields.has(field) || (input.value && input.value !== lastValues[field])) continue;
      const value = job.summary[field];
      if (!value) continue;
      input.value = Array.isArray(value) ? value.join(", ") : value;
      lastValues[field] = input.value;
    }
    onChange();
  }

  async function poll(generation) {
    if (!current(generation)) return;
    try {
      const result = await api(`/api/ai/gallery-jobs/${job.id}`);
      if (!current(generation)) return;
      job = result.job;
      halted = false;
      apply(); render(); onChange({ progressOnly: true });
      if (busy()) timer = setTimeout(() => poll(generation), 1200);
    } catch (error) { if (current(generation)) { halted = true; failureMessage = error.message; render(); } }
  }

  async function start(generation) {
    if (!current(generation) || !gallery.ready() || !config?.available) { render(); return; }
    try {
      const result = await api("/api/ai/gallery-jobs", { images: gallery.snapshot() });
      if (!current(generation)) return;
      job = result.job;
      halted = false;
      apply(); render(); onChange({ progressOnly: true });
      if (busy()) timer = setTimeout(() => poll(generation), 100);
    } catch (error) { if (current(generation)) { halted = true; failureMessage = error.message; render(); } }
  }

  function sync(options = {}) {
    if (options.previewOnly || options.altOnly || options.analysisOnly) return;
    if (scope !== context()) { reset(); }
    const next = currentSignature();
    if (next !== signature) {
      signature = next; epoch += 1; clearTimeout(timer); job = null; halted = false;
    }
    render();
    if (!job && gallery.ready() && config?.available && (!options.restored || context() === "new")) {
      clearTimeout(timer);
      const generation = epoch;
      timer = setTimeout(() => start(generation), 300);
    }
  }

  async function restart(hashes = []) {
    if (locked || !gallery.ready()) return;
    clearTimeout(timer);
    // Refresh configuration status, never switch endpoints or providers on failure.
    try { config = await api("/api/ai/gallery-status"); } catch { halted = true; render(); return; }
    const generation = epoch;
    if (!job) { await start(generation); return; }
    try {
      const result = await api(`/api/ai/gallery-jobs/${job.id}/retry`, { hashes });
      if (!current(generation)) return;
      job = result.job; halted = false; render(); onChange({ progressOnly: true });
      timer = setTimeout(() => poll(generation), 100);
    } catch { if (current(generation)) { halted = true; render(); } }
  }

  function reset(saved = null) {
    epoch += 1; clearTimeout(timer); job = null; signature = currentSignature(); scope = context();
    applied = saved?.applied || ""; lastValues = saved?.lastValues || {};
    protectedFields = new Set(saved?.protectedFields || FIELDS.filter((field) => root.elements.namedItem(field).value));
    halted = false; failureMessage = "";
  }
  retry.addEventListener("click", () => restart());
  cover.addEventListener("click", () => { if (job?.summary?.coverSrc) gallery.setCover(job.summary.coverSrc); });
  root.addEventListener("input", (event) => { if (FIELDS.includes(event.target.name)) protectedFields.add(event.target.name); }, true);

  return {
    sync,
    setLocked(value) { locked = value; if (!value) apply(); render(); },
    jobId: () => job?.id || "",
    snapshot: () => ({ applied, lastValues, protectedFields: [...protectedFields] }),
    restore(saved) { reset(saved); sync({ restored: true }); },
    async init() {
      try { config = await api("/api/ai/gallery-status"); } catch { halted = true; }
      sync({ restored: true });
    },
  };
}
