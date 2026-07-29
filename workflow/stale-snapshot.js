export class StaleSnapshot {
  constructor({
    load,
    ttlMs,
    now = () => Date.now(),
  }) {
    this.load = load;
    this.ttlMs = ttlMs;
    this.now = now;
    this.value = null;
    this.checkedAt = 0;
    this.pending = null;
    this.pendingRevision = -1;
    this.revision = 0;
  }

  invalidate() {
    this.revision += 1;
    this.value = null;
    this.checkedAt = 0;
  }

  async refresh() {
    const revision = this.revision;
    if (!this.pending || this.pendingRevision !== revision) {
      let request;
      request = Promise.resolve()
        .then(() => this.load())
        .then((value) => {
          const accepted = revision === this.revision;
          if (accepted) {
            this.value = value;
            this.checkedAt = this.now();
          }
          return { accepted, value };
        })
        .finally(() => {
          if (this.pending === request) {
            this.pending = null;
            this.pendingRevision = -1;
          }
        });
      this.pending = request;
      this.pendingRevision = revision;
    }
    const result = await this.pending;
    if (!result.accepted) {
      if (this.value) return this.response(this.value, false);
      return this.refresh();
    }
    return this.response(result.value, false);
  }

  response(value, stale) {
    return {
      ...value,
      statusMeta: {
        checkedAt: new Date(this.checkedAt).toISOString(),
        stale,
        refreshing: Boolean(this.pending && this.pendingRevision === this.revision),
      },
    };
  }

  async get({ refresh = false } = {}) {
    if (refresh || !this.value) return this.refresh();
    const stale = this.now() - this.checkedAt >= this.ttlMs;
    if (stale && (!this.pending || this.pendingRevision !== this.revision)) {
      void this.refresh().catch(() => {});
    }
    return this.response(this.value, stale);
  }
}
