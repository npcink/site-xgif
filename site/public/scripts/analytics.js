(() => {
  // Keep local builds and deployment previews out of production statistics.
  const siteHost = document.currentScript?.dataset.siteHost;
  if (!siteHost || window.location.hostname !== siteHost) return;

  window._mtj = window._mtj || [];
  const mtj = document.createElement("script");
  mtj.async = true;
  mtj.src = "https://node90.aizhantj.com:21233/tjjs/?k=5nawhk8s42j";
  document.head.appendChild(mtj);
})();
