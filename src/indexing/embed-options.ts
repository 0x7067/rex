export const EMBED_BATCH_SIZE = 64;
export const EMBED_BATCH_MAX_CHARS = 40000;

export interface EmbedBatchable {
  text: string;
  estimated_tokens?: number;
}

export function createEmbedBatches<T extends EmbedBatchable>(items: T[]): T[][] {
  if (items.length === 0) return [];

  const batches: T[][] = [];
  let current: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemChars = item.text.length;
    const wouldOverflow = current.length > 0 &&
      (current.length >= EMBED_BATCH_SIZE ||
        currentChars + itemChars > EMBED_BATCH_MAX_CHARS);

    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(item);
    currentChars += itemChars;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

export function formatBatchProgress(opts: {
  batchStart: number;
  totalChunks: number;
  batchSize: number;
  elapsedMs: number;
}): string {
  const { batchStart, totalChunks, batchSize, elapsedMs } = opts;
  if (elapsedMs === 0) {
    return `Embedding chunks... (${batchStart}/${totalChunks}) — 0ms/batch`;
  }
  const throughput = Math.round((batchSize / elapsedMs) * 1000);
  return `Embedding chunks... (${batchStart}/${totalChunks}) — ${elapsedMs}ms/batch, ${throughput} chunks/sec`;
}

export function formatEmbedSummary(opts: {
  totalChunks: number;
  totalMs: number;
}): string {
  const { totalChunks, totalMs } = opts;
  const seconds = (totalMs / 1000).toFixed(1);
  if (totalMs === 0 || totalChunks === 0) {
    return `Embedded ${totalChunks} chunks in ${seconds}s`;
  }
  const throughput = Math.round((totalChunks / totalMs) * 1000);
  return `Embedded ${totalChunks} chunks in ${seconds}s (${throughput} chunks/sec)`;
}
