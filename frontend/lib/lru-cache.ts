export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; expires: number }>();

  constructor(private readonly capacity = 500, private readonly ttl = 3_600_000, private readonly now: () => number = Date.now) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttl });
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
