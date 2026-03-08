import crypto from "node:crypto";
import * as lancedb from "@lancedb/lancedb";
import type { Chunk } from "./chunker.js";
import { lanceDir } from "../core/config.js";

const VECTOR_DIM = 768;

export type ChunkRow = {
  id: string;
  resource_id: string;
  resource_name: string;
  file_path: string;
  fingerprint: string;
  chunk_index: number;
  start_line: number;
  end_line: number;
  text: string;
  vector: number[];
  indexed_at: string;
  distance?: number;
  [key: string]: unknown;
};

export type SummaryRow = {
  id: string;
  resource_id: string;
  resource_name: string;
  block_type: string;
  content: string;
  generated_at: string;
  based_on_fingerprints: string;
  [key: string]: unknown;
};

let db: lancedb.Connection | null = null;

async function getDb(): Promise<lancedb.Connection> {
  if (!db) {
    db = await lancedb.connect(lanceDir());
  }
  return db;
}

async function getChunksTable(conn: lancedb.Connection): Promise<lancedb.Table> {
  const tables = await conn.tableNames();
  if (tables.includes("chunks")) {
    return conn.openTable("chunks");
  }
  // Create with a dummy row to establish schema, then delete it
  const dummy: ChunkRow = {
    id: "__init__",
    resource_id: "__init__",
    resource_name: "__init__",
    file_path: "",
    fingerprint: "",
    chunk_index: 0,
    start_line: 0,
    end_line: 0,
    text: "",
    vector: new Array(VECTOR_DIM).fill(0) as number[],
    indexed_at: new Date().toISOString(),
  };
  const table = await conn.createTable("chunks", [dummy]);
  await table.delete('id = "__init__"');
  return table;
}

async function getSummariesTable(conn: lancedb.Connection): Promise<lancedb.Table> {
  const tables = await conn.tableNames();
  if (tables.includes("summaries")) {
    return conn.openTable("summaries");
  }
  const dummy: SummaryRow = {
    id: "__init__",
    resource_id: "__init__",
    resource_name: "__init__",
    block_type: "",
    content: "",
    generated_at: new Date().toISOString(),
    based_on_fingerprints: "[]",
  };
  const table = await conn.createTable("summaries", [dummy]);
  await table.delete('id = "__init__"');
  return table;
}

export async function writeChunks(
  chunks: Chunk[],
  vectors: Float32Array[],
): Promise<void> {
  if (chunks.length === 0) return;
  const conn = await getDb();
  const table = await getChunksTable(conn);

  const rows: ChunkRow[] = chunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    resource_id: chunk.resource_id,
    resource_name: chunk.resource_name,
    file_path: chunk.file_path,
    fingerprint: chunk.fingerprint,
    chunk_index: chunk.chunk_index,
    start_line: chunk.start_line,
    end_line: chunk.end_line,
    text: chunk.text,
    vector: Array.from(vectors[i] ?? new Float32Array(VECTOR_DIM)),
    indexed_at: new Date().toISOString(),
  }));

  await table.add(rows);
}

export async function deleteChunks(resourceId: string): Promise<void> {
  const conn = await getDb();
  const table = await getChunksTable(conn);
  await table.delete(`resource_id = '${resourceId}'`);
}

export async function deleteChunksForFile(
  resourceId: string,
  filePath: string,
): Promise<void> {
  const conn = await getDb();
  const table = await getChunksTable(conn);
  await table.delete(
    `resource_id = '${resourceId}' AND file_path = '${filePath.replace(/'/g, "\\'")}'`,
  );
}

export async function searchChunks(
  queryVector: Float32Array,
  resourceIds: string[],
  topK: number,
): Promise<ChunkRow[]> {
  if (resourceIds.length === 0) return [];
  const conn = await getDb();
  const table = await getChunksTable(conn);

  const idList = resourceIds.map((id) => `'${id}'`).join(", ");
  const filter = `resource_id IN (${idList})`;

  const results = await table
    .vectorSearch(Array.from(queryVector))
    .limit(topK)
    .where(filter)
    .toArray();

  return (results as ChunkRow[]).map((row) => {
    const distance = typeof row._distance === "number" ? row._distance : row.distance;
    const out: ChunkRow = { ...row };
    if (distance !== undefined) out.distance = distance;
    return out;
  });
}

export async function countChunks(resourceId: string): Promise<number> {
  const conn = await getDb();
  const table = await getChunksTable(conn);
  const rows = await table
    .query()
    .where(`resource_id = '${resourceId}'`)
    .select(["id"])
    .toArray();
  return rows.length;
}

export async function getChunkFingerprints(
  resourceId: string,
): Promise<Map<string, string>> {
  const conn = await getDb();
  const table = await getChunksTable(conn);

  const rows = await table
    .query()
    .where(`resource_id = '${resourceId}'`)
    .select(["file_path", "fingerprint"])
    .toArray();

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row["file_path"] as string, row["fingerprint"] as string);
  }
  return map;
}

export async function writeSummaries(rows: Omit<SummaryRow, "id">[]): Promise<void> {
  if (rows.length === 0) return;
  const conn = await getDb();
  const table = await getSummariesTable(conn);

  const withIds = rows.map((r) => ({
    ...r,
    id: crypto.randomUUID(),
  })) as SummaryRow[];

  await table.add(withIds);
}

export async function deleteSummaries(resourceId: string): Promise<void> {
  const conn = await getDb();
  const table = await getSummariesTable(conn);
  await table.delete(`resource_id = '${resourceId}'`);
}

export async function getSummaries(resourceIds: string[]): Promise<SummaryRow[]> {
  if (resourceIds.length === 0) return [];
  const conn = await getDb();
  const table = await getSummariesTable(conn);

  const idList = resourceIds.map((id) => `'${id}'`).join(", ");
  const rows = await table
    .query()
    .where(`resource_id IN (${idList})`)
    .toArray();

  return rows as SummaryRow[];
}

export async function resetDb(): Promise<void> {
  db = null;
}
