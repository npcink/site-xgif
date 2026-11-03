const FIELDS = ["title", "description", "tags", "category", "mood", "scenes"];
const LABELS = { title: "标题", description: "描述", tags: "标签", category: "分类", mood: "情绪", scenes: "场景" };
const displayValue = (value) => Array.isArray(value) ? value.join(", ") : String(value || "");

export function createGalleryAi({ root, api, gallery, context, onChange }) {
  const status = root.querySelector("#image-ai-availability");
  const issues = root.querySelector("#image-ai-issues");
  const retry = root.querySelector('[data-ai-fill="image"]');
  const cover = root.querySelector("#image-ai-cover");
  const progress = root.querySelector("#image-ai-progress");
  const progressBar = root.querySelector("#image-ai-progress-bar");
  const reanalyze = root.querySelector("#image-ai-reanalyze");
  const candidates = root.querySelector("#image-ai-candidates");
  const candidateFields = root.querySelector("#image-ai-candidate-fields");
  const adopt = root.querySelector("#image-ai-apply");
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
  let starting = false;
  let reviewMode = false;
  let resumeId = "";
  let candidateKey = "";
  let proposals = [];
  const currentSignature = () => JSON.stringify(gallery.snapshot().map((image) => image.src));
  const current = (generation) => generation === epoch && scope === context() && signature === currentSignature();
  const busy = () => starting || (!halted && job && ["queued", "running", "summarizing"].includes(job.state));

  function renderCandidates() {
    candidates.hidden = !reviewMode || !job?.summary;
    if (candidates.hidden) return;
    const key = `${job.id}:${job.revision}`;
    adopt.disabled = locked || Boolean(busy()) || !candidateFields.querySelector("input:checked");
    for (const input of candidateFields.querySelectorAll("input")) input.disabled = locked || Boolean(busy());
    if (key === candidateKey) return;
    candidateKey = key;
    proposals = FIELDS.map((field) => ({ field, label: LABELS[field], value: displayValue(job.summary[field]), current: root.elements.namedItem(field).value }));
    for (const [index, item] of job.items.entries()) {
      if (item.result?.altText) proposals.push({ src: item.src, label: `第 ${index + 1} 张图片描述`, value: item.result.altText.slice(0, 160), current: gallery.snapshot().find((image) => image.src === item.src)?.altText || "" });
    }
    proposals = proposals.filter((proposal) => proposal.value && proposal.current !== proposal.value);
    candidateFields.replaceChildren();
    for (const [index, proposal] of proposals.entries()) {
      const row = document.createElement("label");
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = String(index); checkbox.disabled = locked || Boolean(busy());
      checkbox.setAttribute("aria-label", `采用新${proposal.label}`);
      const copy = document.createElement("span");
      const title = document.createElement("strong"); title.textContent = proposal.label;
      const before = document.createElement("span"); before.textContent = `当前：${proposal.current || "未填写"}`;
      const after = document.createElement("span"); after.textContent = `新建议：${proposal.value}`;
      copy.append(title, before, after); row.append(checkbox, copy); candidateFields.append(row);
    }
    root.querySelector("#image-ai-apply-status").textContent = proposals.length ? "新建议尚未采用。" : "新建议与当前资料一致。";
    adopt.disabled = true;
  }

  function renderProgress() {
    const total = gallery.draftSnapshot().length;
    const done = job?.items.filter((item) => item.state === "done").length || 0;
    const stage = !gallery.ready() ? 0 : job?.state === "done" || (!job && context() !== "new") ? 3 : job?.state === "summarizing" ? 2 : 1;
    progress.dataset.state = halted || ["attention", "paused"].includes(job?.state) ? "attention" : busy() ? "running" : job?.state || "idle";
    progressBar.setAttribute("aria-busy", String(Boolean(busy())));
    let heading = "图片处理进度";
    if (total) {
      const running = job?.items.findIndex((item) => item.state === "running") ?? -1;
      heading = !gallery.ready() ? `正在上传图片 · ${gallery.snapshot().length} / ${total}`
        : starting ? "正在创建识别任务"
        : halted || ["attention", "paused"].includes(job?.state) ? `识别需要处理 · 已完成 ${done} / ${total} 张`
        : job?.state === "done" ? reviewMode ? "重新识别完成 · 请对照新建议" : "图片资料已整理 · 请检查确认"
        : job?.state === "summarizing" ? "逐张识别完成 · 正在整理资料"
        : running >= 0 ? `正在识别第 ${running + 1} / ${total} 张` : context() !== "new" && !job ? "已有图片资料 · 可重新识别" : "等待开始识别";
    }
    root.querySelector("#image-ai-heading").textContent = heading;
    progressBar.hidden = !total || !config?.available || (!job && context() !== "new");
    progressBar.max = total + 1;
    progressBar.value = done + (job?.summary ? 1 : 0);
    progressBar.setAttribute("aria-valuetext", `已识别 ${done} / ${total} 张${job?.summary ? "，资料已整理" : ""}`);
    for (const [index, step] of [...progress.querySelectorAll("[data-ai-step]")].entries()) {
      step.dataset.state = total ? index < stage ? "done" : index === stage ? "current" : "pending" : "pending";
      if (total && index === stage) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current");
    }
    const model = job || config;
    const when = job?.updatedAt ? ` · 本次更新 ${new Date(job.updatedAt).toLocaleString("zh-CN", { hour12: false })}` : "";
    root.querySelector("#image-ai-model").textContent = model?.model
      ? `${job ? "本次识别模型" : "当前配置模型"}：${model.model}${model.modelVersion ? ` · 版本 ${model.modelVersion}` : ""}${when}` : "识别模型：尚未配置";
  }

  function render() {
    retry.disabled = locked || !gallery.ready() || Boolean(busy());
    retry.textContent = busy() ? "正在整理…" : job?.state === "done" ? "重新汇总" : "继续整理 / 重试";
    reanalyze.disabled = locked || !gallery.ready() || Boolean(busy()) || !config?.available;
    cover.hidden = !job?.summary?.coverSrc || job.summary.coverSrc === gallery.snapshot()[0]?.src;
    cover.disabled = locked;
    issues.replaceChildren();
    renderProgress(); renderCandidates();
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
    } else status.textContent = halted ? `${failureMessage || "M4 暂时无法连接"} 图片与资料已保留，可重试或手动整理。`
      : context() !== "new" ? "使用更强模型时，点击重新识别，对照后选择采用新建议。" : "正在准备图集整理任务…";
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
    gallery.setAnalysis(job, { applySuggestions: !reviewMode });
    if (reviewMode) return;
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

  async function start(generation, { force = false, review = false } = {}) {
    if (!current(generation) || !gallery.ready() || !config?.available) { render(); return; }
    starting = true; render();
    try {
      const result = await api("/api/ai/gallery-jobs", { images: gallery.snapshot(), ...(force ? { force: true } : {}) });
      if (!current(generation)) return;
      job = result.job; reviewMode = review; candidateKey = "";
      starting = false;
      halted = false;
      apply(); render(); onChange({ progressOnly: true });
      if (busy()) timer = setTimeout(() => poll(generation), 100);
    } catch (error) { if (current(generation)) { halted = true; failureMessage = error.message; } }
    finally { if (current(generation)) { starting = false; render(); } }
  }

  async function resume(generation, id) {
    starting = true; render();
    try {
      const result = await api(`/api/ai/gallery-jobs/${id}`);
      if (!current(generation)) return;
      if (JSON.stringify(result.job.items.map((item) => item.src)) !== signature) throw new Error("任务图片已变化，请重新识别。");
      job = result.job; starting = false; apply(); render();
      if (busy()) timer = setTimeout(() => poll(generation), 100);
    } catch (error) { if (current(generation)) { halted = true; failureMessage = error.message; } }
    finally { if (current(generation)) { starting = false; render(); } }
  }

  function sync(options = {}) {
    if (options.previewOnly || options.altOnly || options.analysisOnly) return;
    if (scope !== context()) { reset(); }
    const next = currentSignature();
    if (next !== signature) {
      signature = next; epoch += 1; clearTimeout(timer); job = null; halted = false; starting = false; reviewMode = false; resumeId = ""; candidateKey = "";
    }
    render();
    if (resumeId) { const id = resumeId; resumeId = ""; void resume(epoch, id); return; }
    if (!job && !starting && gallery.ready() && config?.available && (!options.restored || context() === "new")) {
      clearTimeout(timer);
      const generation = epoch;
      timer = setTimeout(() => start(generation), 300);
    }
  }

  async function restart(hashes = []) {
    if (locked || !gallery.ready() || busy()) return;
    clearTimeout(timer);
    const generation = epoch;
    starting = true; render();
    // Refresh configuration status, never switch endpoints or providers on failure.
    try {
      const nextConfig = await api("/api/ai/gallery-status");
      if (!current(generation)) return;
      config = nextConfig;
      if (!job) { await start(generation); return; }
      if (job.model !== config.model || (job.modelVersion || "") !== (config.modelVersion || "") || (job.endpoint && job.endpoint !== config.baseUrl)) {
        await start(generation, { review: true }); return;
      }
      const result = await api(`/api/ai/gallery-jobs/${job.id}/retry`, { hashes });
      if (!current(generation)) return;
      job = result.job; starting = false; halted = false; render(); onChange({ progressOnly: true });
      timer = setTimeout(() => poll(generation), 100);
    } catch (error) { if (current(generation)) { halted = true; failureMessage = error.message; } }
    finally { if (current(generation)) { starting = false; render(); } }
  }

  async function reidentify() {
    if (locked || busy() || !gallery.ready()) return;
    epoch += 1; clearTimeout(timer);
    const generation = epoch;
    starting = true; render();
    try {
      const nextConfig = await api("/api/ai/gallery-status");
      if (!current(generation)) return;
      config = nextConfig;
      await start(generation, { force: true, review: true });
    } catch (error) { if (current(generation)) { halted = true; failureMessage = error.message; } }
    finally { if (current(generation)) { starting = false; render(); } }
  }

  function reset(saved = null) {
    epoch += 1; clearTimeout(timer); job = null; signature = currentSignature(); scope = context();
    applied = saved?.applied || ""; lastValues = saved?.lastValues || {};
    protectedFields = new Set(saved?.protectedFields || FIELDS.filter((field) => root.elements.namedItem(field).value));
    halted = false; failureMessage = "";
    starting = false; reviewMode = Boolean(saved?.reviewMode); candidateKey = "";
    resumeId = saved?.signature === signature ? saved.jobId || "" : "";
  }
  retry.addEventListener("click", () => restart());
  reanalyze.addEventListener("click", reidentify);
  candidateFields.addEventListener("change", () => { adopt.disabled = locked || Boolean(busy()) || !candidateFields.querySelector("input:checked"); });
  adopt.addEventListener("click", () => {
    if (locked || busy()) return;
    const selected = [...candidateFields.querySelectorAll("input:checked")].map((input) => proposals[Number(input.value)]);
    if (selected.some((proposal) => proposal.current !== (proposal.field
      ? root.elements.namedItem(proposal.field).value : gallery.snapshot().find((image) => image.src === proposal.src)?.altText || ""))) {
      candidateKey = ""; renderCandidates();
      root.querySelector("#image-ai-apply-status").textContent = "当前资料已修改，请重新对照并勾选建议。";
      return;
    }
    for (const proposal of selected.filter((item) => item.field)) {
      root.elements.namedItem(proposal.field).value = proposal.value;
      lastValues[proposal.field] = proposal.value; protectedFields.add(proposal.field);
    }
    gallery.applyAltSuggestions(selected.filter((item) => item.src).map((item) => ({ src: item.src, altText: item.value })));
    onChange(); candidateKey = ""; renderCandidates();
    root.querySelector("#image-ai-apply-status").textContent = `已采用 ${selected.length} 项建议，请检查后保存。`;
  });
  cover.addEventListener("click", () => { if (job?.summary?.coverSrc) gallery.setCover(job.summary.coverSrc); });
  root.addEventListener("input", (event) => { if (FIELDS.includes(event.target.name)) protectedFields.add(event.target.name); }, true);

  return {
    sync,
    setLocked(value) { locked = value; if (!value) apply(); render(); },
    jobId: () => job?.id || "",
    snapshot: () => ({ applied, lastValues, protectedFields: [...protectedFields], jobId: job?.id || "", signature, reviewMode }),
    restore(saved) { reset(saved); sync({ restored: true }); },
    async init() {
      try { config = await api("/api/ai/gallery-status"); } catch { halted = true; }
      sync({ restored: true });
    },
  };
}
