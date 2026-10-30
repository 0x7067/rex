import { embedOne } from "../indexing/embedder.js";
import { searchHybridChunks } from "../indexing/store.js";

const DEFAULT_PER_RESOURCE_CAP = 10;
const DEFAULT_TOTAL_CAP = 40;
export interface RetrievedChunk {
  resource_id: string;
  resource_name: string;
  file_path: string;
  chunk_index: number;
  start_line: number;
  end_line: number;
  text: string;
  /** RRF relevance, higher is better. */
  score: number;
}
export async function retrieve(
  question: string,
  resourceIds: string[],
  options: {
    perResourceCap?: number;
    totalCap?: number;
    collapseByFile?: boolean;
  } = {},
): Promise<RetrievedChunk[]> {
  if (resourceIds.length === 0) return [];
  const perResourceCap = options.perResourceCap ?? DEFAULT_PER_RESOURCE_CAP;
  const totalCap = options.totalCap ?? DEFAULT_TOTAL_CAP;
  const vector = await embedOne(question);
  // Each resource gets candidates before the global cap; a large repository cannot starve another.
  const groups: RetrievedChunk[][] = [];
  for (const resourceId of new Set(resourceIds)) {
    const candidates = await searchHybridChunks(
      question,
      vector,
      [resourceId],
      perResourceCap * 4,
    );
    const seen = new Set<string>();
    const group: RetrievedChunk[] = [];
    for (const row of candidates) {
      const key = options.collapseByFile
        ? row.file_path
        : `${row.file_path}:${row.start_line}:${row.end_line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      group.push({
        resource_id: row.resource_id,
        resource_name: row.resource_name,
        file_path: row.file_path,
        chunk_index: row.chunk_index,
        start_line: row.start_line,
        end_line: row.end_line,
        text: row.text,
        score: row.relevance ?? 0,
      });
      if (group.length >= perResourceCap) break;
    }
    groups.push(group);
  }
  // Round-robin ranks preserve cross-resource coverage; each group's order comes from RRF.
  const selected: RetrievedChunk[] = [];
  for (
    let rank = 0;
    rank < perResourceCap && selected.length < totalCap;
    rank++
  ) {
    for (const group of groups) {
      const chunk = group[rank];
      if (chunk && selected.length < totalCap) selected.push(chunk);
    }
  }
  return selected;
}
