import { embedOne } from "../indexing/embedder.js";
import { type ChunkRow, searchChunks } from "../indexing/store.js";

const DEFAULT_PER_RESOURCE_CAP = 10;
const DEFAULT_TOTAL_CAP = 40;

type PathBiasMode = "none" | "codex-fast";

export interface RetrievedChunk {
  resource_id: string;
  resource_name: string;
  file_path: string;
  chunk_index: number;
  start_line: number;
  end_line: number;
  text: string;
  score: number;
}

export async function retrieve(
  question: string,
  resourceIds: string[],
  options: {
    perResourceCap?: number;
    totalCap?: number;
    collapseByFile?: boolean;
    pathBias?: PathBiasMode;
  } = {},
): Promise<RetrievedChunk[]> {
  if (resourceIds.length === 0) return [];

  const perResourceCap = options.perResourceCap ?? DEFAULT_PER_RESOURCE_CAP;
  const totalCap = options.totalCap ?? DEFAULT_TOTAL_CAP;
  const collapseByFile = options.collapseByFile ?? false;
  const pathBias = options.pathBias ?? "none";

  const queryVector = await embedOne(question);

  // Fetch enough candidates to allow per-resource capping
  const candidates = await searchChunks(
    queryVector,
    resourceIds,
    totalCap * 2,
  );

  // Group by resource_id and cap per resource
  const byResource = new Map<string, ChunkRow[]>();
  for (const row of candidates) {
    const list = byResource.get(row.resource_id) ?? [];
    list.push(row);
    byResource.set(row.resource_id, list);
  }

  const selected: RetrievedChunk[] = [];
  for (const [, rows] of byResource) {
    const ranked = [...rows].sort((a, b) => compareRows(a, b, pathBias));
    const seenFiles = new Set<string>();

    for (const row of ranked) {
      if (collapseByFile && seenFiles.has(row.file_path)) {
        continue;
      }
      seenFiles.add(row.file_path);
      const startLine = typeof row.start_line === "number" && row.start_line > 0 ? row.start_line : Number.NaN;
      const endLine = typeof row.end_line === "number" && row.end_line >= startLine ? row.end_line : Number.NaN;
      selected.push({
        resource_id: row.resource_id,
        resource_name: row.resource_name,
        file_path: row.file_path,
        chunk_index: row.chunk_index,
        start_line: startLine,
        end_line: endLine,
        text: row.text,
        score: row.distance ?? 0,
      });
      if (seenFiles.size >= perResourceCap || (!collapseByFile && selected.length >= perResourceCap)) {
        break;
      }
    }
  }

  selected.sort((a, b) => compareRetrieved(a, b, pathBias));

  return selected.slice(0, totalCap);
}

function compareRows(a: ChunkRow, b: ChunkRow, pathBias: PathBiasMode): number {
  const scoreDiff = adjustedScore(a.file_path, a.distance ?? 0, pathBias)
    - adjustedScore(b.file_path, b.distance ?? 0, pathBias);
  if (scoreDiff !== 0) return scoreDiff;
  return a.chunk_index - b.chunk_index;
}

function compareRetrieved(a: RetrievedChunk, b: RetrievedChunk, pathBias: PathBiasMode): number {
  const scoreDiff = adjustedScore(a.file_path, a.score, pathBias)
    - adjustedScore(b.file_path, b.score, pathBias);
  if (scoreDiff !== 0) return scoreDiff;
  return a.chunk_index - b.chunk_index;
}

function adjustedScore(
  filePath: string,
  score: number,
  pathBias: PathBiasMode,
): number {
  if (pathBias === "none") return score;
  return score + pathBiasWeight(filePath);
}

function pathBiasWeight(filePath: string): number {
  if (filePath.startsWith("src/")) return -0.05;
  if (filePath.startsWith("test/")) return 0.02;
  if (filePath.startsWith("docs/specs/")) return 0.03;
  if (
    filePath.startsWith(".crush/")
    || filePath.startsWith(".claude/")
    || filePath.startsWith("docs/plans/")
  ) {
    return 0.20;
  }
  return 0;
}
