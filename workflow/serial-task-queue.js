export class SerialTaskQueue {
  constructor() {
    this.tail = Promise.resolve();
    this.pending = 0;
  }

  run(task) {
    this.pending += 1;
    const scheduled = this.tail.then(task, task);
    const result = scheduled.finally(() => {
      this.pending -= 1;
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
