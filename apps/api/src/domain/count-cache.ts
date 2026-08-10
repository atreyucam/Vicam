type Entry = {
  expiresAt: number;
  value?: number;
  pending?: Promise<number>;
};

export class CountCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ttlMs = 5_000) {}

  get(key: string, load: () => Promise<number>): Promise<number> {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (entry?.value !== undefined) {
      if (entry.expiresAt <= now && entry.pending === undefined) {
        entry.pending = load().then(
          (value) => {
            entry.value = value;
            entry.expiresAt = Date.now() + this.ttlMs;
            delete entry.pending;
            return value;
          },
          () => {
            entry.expiresAt = Date.now() + this.ttlMs;
            delete entry.pending;
            return entry.value!;
          },
        );
      }
      return Promise.resolve(entry.value);
    }
    if (entry?.pending !== undefined) return entry.pending;

    const created: Entry = { expiresAt: now + this.ttlMs };
    created.pending = load().then(
      (value) => {
        created.value = value;
        created.expiresAt = Date.now() + this.ttlMs;
        delete created.pending;
        return value;
      },
      (error: unknown) => {
        this.entries.delete(key);
        throw error;
      },
    );
    this.entries.set(key, created);
    return created.pending;
  }

  clear(): void {
    this.entries.clear();
  }
}
