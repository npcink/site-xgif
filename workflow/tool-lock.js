import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";

export async function withToolLock(workflowRoot, action) {
  const directory = path.join(workflowRoot, ".runtime");
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, "content-tools.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("另一个内容工具正在运行；若进程已退出，请核实后删除 workflow/.runtime/content-tools.lock。");
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath);
  }
}
