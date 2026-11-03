// Replace uploaded bytes with a small reference atomically. A pending draft can
// still recover if the page closes before LocalStorage records the upload result.
export function createPendingImageStore() {
  let connection;
  function database() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("xgif-publisher-pending-images", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { connection = null; reject(new Error("浏览器无法暂存待上传文件")); };
    });
    return connection;
  }
  async function transaction(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const request = action(tx.objectStore("files"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error("浏览器未能保存或读取待上传文件"));
    });
  }
  return {
    put: (item, scope) => transaction("readwrite", (store) => store.put({ id: item.id, scope, name: item.name, dataUrl: item.dataUrl, width: item.width, height: item.height })),
    complete: (item) => transaction("readwrite", (store) => store.put({ id: item.id, scope: item.scope, name: item.name, src: item.src, width: item.width, height: item.height })),
    remove: (id) => transaction("readwrite", (store) => store.delete(id)),
    async read(id, scope) {
      const item = await transaction("readonly", (store) => store.get(id));
      return item?.scope === scope ? item : null;
    },
  };
}
