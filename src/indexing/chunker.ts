import fs from "node:fs";
import crypto from "node:crypto";
import type { FileEntry } from "../adapters/adapter.js";

const TARGET_CHUNK_TOKENS = 600;
const MAX_CHUNK_TOKENS = 850;
const OVERLAP_TOKENS = 40;
// Rough approximation: 1 token ≈ 4 characters for English/code
const CHARS_PER_TOKEN = 4;

export interface Chunk {
  resource_id: string;
  resource_name: string;
  file_path: string;
  fingerprint: string;
  chunk_index: number;
  start_line: number;
  end_line: number;
  text: string;
  chunk_hash: string;
  estimated_tokens: number;
}

export function chunkText(
  text: string,
  entry: FileEntry,
  resourceId: string,
  resourceName: string,
  fingerprint: string,
): Chunk[] {
  if (text.length === 0) return [];

  const targetChars = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN;
  const maxChars = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN;
  const overlapChars = OVERLAP_TOKENS * CHARS_PER_TOKEN;
  const chunks: Chunk[] = [];
  const lineStarts = buildLineStarts(text);

  let start = 0;
  let index = 0;

  while (start < text.length) {
    const { end, strongBoundary } = findChunkEnd(text, start, targetChars, maxChars);
    const chunkTextValue = text.slice(start, end);
    const startLine = lineNumberAtOffset(lineStarts, start);
    const endLine = lineNumberAtOffset(lineStarts, Math.max(start, end - 1));
    chunks.push({
      resource_id: resourceId,
      resource_name: resourceName,
      file_path: entry.relativePath,
      fingerprint,
      chunk_index: index,
      start_line: startLine,
      end_line: endLine,
      text: chunkTextValue,
      chunk_hash: hashChunk(chunkTextValue),
      estimated_tokens: estimateTokens(chunkTextValue),
    });
    if (end === text.length) break;
    start = strongBoundary ? end : Math.max(end - overlapChars, start + 1);
    index++;
  }

  return chunks;
}

export function chunkFile(
  entry: FileEntry,
  resourceId: string,
  resourceName: string,
  fingerprint: string,
): Chunk[] {
  let text: string;
  try {
    text = fs.readFileSync(entry.absolutePath, "utf-8");
  } catch {
    return [];
  }
  return chunkText(text, entry, resourceId, resourceName, fingerprint);
}

function findChunkEnd(
  text: string,
  start: number,
  targetChars: number,
  maxChars: number,
): { end: number; strongBoundary: boolean } {
  const remaining = text.length - start;
  if (remaining <= maxChars) {
    return { end: text.length, strongBoundary: true };
  }

  const minEnd = Math.min(start + Math.floor(targetChars * 0.6), text.length);
  const hardEnd = Math.min(start + maxChars, text.length);
  let best: { score: number; end: number; strongBoundary: boolean } | null = null;

  for (let cursor = hardEnd; cursor >= minEnd; cursor--) {
    const score = boundaryScore(text, cursor);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = {
        score,
        end: cursor,
        strongBoundary: score >= 5,
      };
      if (score >= 7) break;
    }
  }

  if (best) {
    return { end: best.end, strongBoundary: best.strongBoundary };
  }

  return { end: hardEnd, strongBoundary: false };
}

function boundaryScore(text: string, cursor: number): number {
  const before = text.slice(Math.max(0, cursor - 120), cursor);
  const after = text.slice(cursor, Math.min(text.length, cursor + 120));

  if (before.endsWith("\n\n")) return 8;
  if (/\n#{1,6} [^\n]*$/.test(before)) return 7;
  if (/^\n(?:export |async function |function |class |interface |type |describe\(|it\(|test\()/.test(after)) {
    return 6;
  }
  if (/[.!?]["')\]]?\s*$/.test(before)) return 5;
  if (before.endsWith("\n")) return 3;
  if (before.endsWith(" ")) return 1;
  return 0;
}

function hashChunk(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n" && index + 1 < text.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineNumberAtOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid] ?? 0;
    const nextStart = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (offset < start) {
      high = mid - 1;
      continue;
    }
    if (offset >= nextStart) {
      low = mid + 1;
      continue;
    }
    return mid + 1;
  }

  return lineStarts.length;
}
