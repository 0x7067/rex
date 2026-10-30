import crypto from "node:crypto";
import * as lancedb from "@lancedb/lancedb";
import {
  Field,
  FixedSizeList,
  Float32,
  Float64,
  Schema,
  Utf8,
  Vector,
} from "apache-arrow";
import { z } from "zod";
import type { Chunk } from "./chunker.js";
import { lanceDir } from "../core/config.js";

const VECTOR_DIM = 768;
const vectorSchema = z.preprocess(
  (value) =>
    value instanceof Vector
      ? Array.from(value.toArray())
      : value instanceof Float32Array
        ? Array.from(value)
        : value,
  z.array(z.number().finite()).length(VECTOR_DIM),
);
const ChunkRowSchema = z.object({
  id: z.string(),
  resource_id: z.string(),
  resource_name: z.string(),
  file_path: z.string(),
  fingerprint: z.string(),
  chunk_index: z.number(),
  start_line: z.number(),
  end_line: z.number(),
  text: z.string(),
  search_text: z.string().optional(),
  vector: vectorSchema,
  indexed_at: z.string(),
  distance: z.number().optional(),
  relevance: z.number().optional(),
});
export type ChunkRow = z.infer<typeof ChunkRowSchema>;
const SummaryRowSchema = z.object({
  id: z.string(),
  resource_id: z.string(),
  resource_name: z.string(),
  block_type: z.string(),
  content: z.string(),
  generated_at: z.string(),
  based_on_fingerprints: z.string(),
});
export type SummaryRow = z.infer<typeof SummaryRowSchema>;

let db: lancedb.Connection | null = null;
let chunksTable: Promise<lancedb.Table> | null = null;
async function getDb(): Promise<lancedb.Connection> {
  db ??= await lancedb.connect(lanceDir());
  return db;
}
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
function resourceFilter(ids: string[]): string {
  return `resource_id IN (${ids.map(sqlString).join(", ")})`;
}

async function getChunksTable(): Promise<lancedb.Table> {
  chunksTable ??= openChunksTable().catch((error: unknown) => {
    chunksTable = null;
    throw error;
  });
  return chunksTable;
}
async function openChunksTable(): Promise<lancedb.Table> {
  const conn = await getDb();
  if ((await conn.tableNames()).includes("chunks")) {
    const table = await conn.openTable("chunks");
    // Old indexes retain their data; the next sync migrates the encoding profile.
    if (
      !(await table.schema()).fields.some(
        (field) => field.name === "search_text",
      )
    ) {
      await table.addColumns([
        { name: "search_text", valueSql: "file_path || '\n' || text" },
      ]);
    }
    return table;
  }
  const strings = [
    "id",
    "resource_id",
    "resource_name",
    "file_path",
    "fingerprint",
    "text",
    "search_text",
    "indexed_at",
  ];
  const schema = new Schema([
    ...strings.map((name) => new Field(name, new Utf8(), true)),
    ...["chunk_index", "start_line", "end_line"].map(
      (name) => new Field(name, new Float64(), true),
    ),
    new Field(
      "vector",
      new FixedSizeList(VECTOR_DIM, new Field("item", new Float32(), true)),
      true,
    ),
  ]);
  return conn.createEmptyTable("chunks", schema);
}
async function getSummariesTable(): Promise<lancedb.Table> {
  const conn = await getDb();
  if ((await conn.tableNames()).includes("summaries"))
    return conn.openTable("summaries");
  return conn.createEmptyTable(
    "summaries",
    new Schema(
      Object.keys(SummaryRowSchema.shape).map(
        (name) => new Field(name, new Utf8(), true),
      ),
    ),
  );
}
async function buildTextIndex(table: lancedb.Table): Promise<void> {
  await table.createIndex("search_text", {
    config: lancedb.Index.fts({
      baseTokenizer: "code",
      lowercase: true,
      stem: false,
      removeStopWords: false,
      maxTokenLength: 256,
    }),
    replace: true,
  });
}
function parseRows(rows: unknown[]): ChunkRow[] {
  return rows.map((value) => {
    const raw = z
      .record(z.string(), z.unknown())
      .parse(
        typeof value === "object" && value !== null ? { ...value } : value,
      );
    return ChunkRowSchema.parse({
      ...raw,
      distance: raw["_distance"] ?? raw["distance"],
      relevance: raw["_relevance_score"],
    });
  });
}
export function createChunkRows(
  chunks: Chunk[],
  vectors: Float32Array[],
): ChunkRow[] {
  if (vectors.length !== chunks.length)
    throw new Error("Each chunk must have exactly one embedding");
  return chunks.map((chunk, index) =>
    ChunkRowSchema.parse({
      ...chunk,
      id: crypto
        .createHash("sha256")
        .update(
          `${chunk.resource_id}\0${chunk.file_path}\0${chunk.chunk_index}`,
        )
        .digest("hex"),
      search_text: `${chunk.file_path}\n${chunk.text}`,
      vector: vectors[index],
      indexed_at: new Date().toISOString(),
    }),
  );
}
export async function writeChunks(
  chunks: Chunk[],
  vectors: Float32Array[],
): Promise<void> {
  if (chunks.length === 0) return;
  const table = await getChunksTable();
  await table.add(createChunkRows(chunks, vectors));
  await buildTextIndex(table);
}
/** Replace one resource in a single table commit, preserving all other resources. */
export async function replaceResourceChunks(
  resourceId: string,
  rows: ChunkRow[],
): Promise<void> {
  if (rows.some((row) => row.resource_id !== resourceId))
    throw new Error("Cannot replace chunks belonging to another resource");
  const table = await getChunksTable();
  const data = rows.map((row) => ({
    ...ChunkRowSchema.parse(row),
    search_text: `${row.file_path}\n${row.text}`,
  }));
  await table
    .mergeInsert("id")
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .whenNotMatchedBySourceDelete({
      where: `resource_id = ${sqlString(resourceId)}`,
    })
    .execute(data);
  await buildTextIndex(table);
}
export async function getResourceChunks(
  resourceId: string,
): Promise<ChunkRow[]> {
  const table = await getChunksTable();
  return parseRows(
    await table
      .query()
      .where(resourceFilter([resourceId]))
      .toArray(),
  );
}
export async function deleteChunks(resourceId: string): Promise<void> {
  await (await getChunksTable()).delete(resourceFilter([resourceId]));
}
export async function deleteChunksForFile(
  resourceId: string,
  filePath: string,
): Promise<void> {
  await (
    await getChunksTable()
  ).delete(
    `${resourceFilter([resourceId])} AND file_path = ${sqlString(filePath)}`,
  );
}
/** Dense-only search remains available for baseline evaluation. */
export async function searchChunks(
  queryVector: Float32Array,
  resourceIds: string[],
  topK: number,
): Promise<ChunkRow[]> {
  if (resourceIds.length === 0) return [];
  return parseRows(
    await (
      await getChunksTable()
    )
      .vectorSearch(Array.from(queryVector))
      .distanceType("cosine")
      .limit(topK)
      .where(resourceFilter(resourceIds))
      .toArray(),
  );
}
/** Built-in reciprocal rank fusion avoids comparing BM25 and cosine on one raw scale. */
export async function searchHybridChunks(
  question: string,
  queryVector: Float32Array,
  resourceIds: string[],
  topK: number,
): Promise<ChunkRow[]> {
  if (resourceIds.length === 0) return [];
  const table = await getChunksTable();
  if (
    !(await table.listIndices()).some((index) =>
      index.columns.includes("search_text"),
    )
  )
    await buildTextIndex(table);
  const reranker = await lancedb.rerankers.RRFReranker.create();
  return parseRows(
    await table
      .vectorSearch(Array.from(queryVector))
      .distanceType("cosine")
      .fullTextSearch(question, { columns: ["search_text"] })
      .where(resourceFilter(resourceIds))
      .rerank(reranker)
      .limit(topK)
      .toArray(),
  );
}
export async function countChunks(resourceId: string): Promise<number> {
  return (await getChunksTable()).countRows(resourceFilter([resourceId]));
}
export async function getChunkFingerprints(
  resourceId: string,
): Promise<Map<string, string>> {
  return new Map(
    (await getResourceChunks(resourceId)).map((row) => [
      row.file_path,
      row.fingerprint,
    ]),
  );
}
export async function writeSummaries(
  rows: Omit<SummaryRow, "id">[],
): Promise<void> {
  if (rows.length === 0) return;
  const resourceId = rows[0]?.resource_id;
  if (!resourceId || rows.some((row) => row.resource_id !== resourceId))
    throw new Error("Summary replacement must belong to one resource");
  const table = await getSummariesTable();
  await table
    .mergeInsert("id")
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .whenNotMatchedBySourceDelete({
      where: `resource_id = ${sqlString(resourceId)}`,
    })
    .execute(
      rows.map((row) => ({
        ...row,
        id: `${row.resource_id}:${row.block_type}`,
      })),
    );
}
export async function deleteSummaries(resourceId: string): Promise<void> {
  await (await getSummariesTable()).delete(resourceFilter([resourceId]));
}
export async function getSummaries(
  resourceIds: string[],
): Promise<SummaryRow[]> {
  if (resourceIds.length === 0) return [];
  const rows = await (
    await getSummariesTable()
  )
    .query()
    .where(resourceFilter(resourceIds))
    .toArray();
  return rows.map((row: unknown) =>
    SummaryRowSchema.parse(
      typeof row === "object" && row !== null ? { ...row } : row,
    ),
  );
}
export async function resetDb(): Promise<void> {
  db?.close();
  db = null;
  chunksTable = null;
}
