// Priority queue with bounded concurrency. priority 1 runs before 2 before 3; FIFO within
// a priority. This is where Jev's `priority` decision becomes real: it sets queue position.

export class PriorityQueue {
  #waiting = [];
  #running = 0;
  #seq = 0;
  constructor(concurrency = 4) {
    this.concurrency = concurrency;
  }
  get stats() {
    return { running: this.#running, waiting: this.#waiting.length };
  }
  run(priority, task) {
    return new Promise((resolve, reject) => {
      this.#waiting.push({ priority, seq: this.#seq++, task, resolve, reject, enqueuedAt: Date.now() });
      this.#waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this.#pump();
    });
  }
  #pump() {
    while (this.#running < this.concurrency && this.#waiting.length) {
      const job = this.#waiting.shift();
      this.#running++;
      Promise.resolve()
        .then(() => job.task({ queued_ms: Date.now() - job.enqueuedAt }))
        .then(job.resolve, job.reject)
        .finally(() => {
          this.#running--;
          this.#pump();
        });
    }
  }
}
