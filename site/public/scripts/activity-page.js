import { readMetrics } from "./discovery-metrics.js";

let storage;
try { storage = window.sessionStorage; } catch { /* Display the unavailable state below. */ }

function update() {
  const metrics = readMetrics(storage);
  document.querySelectorAll("[data-metric]").forEach((element) => {
    element.textContent = String(metrics[element.dataset.metric] || 0);
  });
  const rate = metrics.recommendationImpressions ? metrics.recommendationClicks / metrics.recommendationImpressions * 100 : 0;
  document.querySelector("[data-click-rate]").textContent = `${rate.toFixed(1)}%`;
  if (!storage) document.querySelector("[data-activity-status]").textContent = "浏览器未允许保存记录，无法跨页面汇总。";
}

document.querySelector("[data-export-activity]")?.addEventListener("click", () => {
  const data = { scope: "current-tab", exportedAt: new Date().toISOString(), ...readMetrics(storage) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "xgif-browsing.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener("pageshow", update);
update();
