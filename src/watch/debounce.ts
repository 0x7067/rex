export function createDebouncedBatch<T>(keyFn: (item: T) => string): {
  add(item: T): void;
  flush(): T[];
  readonly pending: number;
} {
  const map = new Map<string, T>();

  return {
    add(item: T): void {
      map.set(keyFn(item), item);
    },
    flush(): T[] {
      const items = [...map.values()];
      map.clear();
      return items;
    },
    get pending(): number {
      return map.size;
    },
  };
}
