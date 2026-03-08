import { type SummaryRow, writeSummaries } from "../indexing/store.js";
import { getProvider, type ProviderCallOptions } from "../provider/interface.js";
import type { ProviderConfig, Resource } from "../core/resource.js";
import type { RetrievedChunk } from "./retriever.js";

const SUMMARY_BLOCK_TYPES = ["identity", "architecture", "conventions"] as const;

export interface Answer {
  answer: string;
  sources: Array<{
    resource: string;
    path: string;
    lines?: [number, number];
  }>;
}

export function buildPrompt(
  resources: Resource[],
  summaries: SummaryRow[],
  chunks: RetrievedChunk[],
  question: string,
): string {
  const parts: string[] = [];

  parts.push(
    `[System]: You are a helpful assistant. Answer based only on the provided context.` +
    ` Each context section is labeled with its resource name and ID.` +
    ` Cite sources by resource name, file path, and line span when making specific claims.` +
    ` Do not blend information across resources without explicitly attributing each claim.` +
    ` After the answer, append a machine-readable citation block in this exact format:` +
    ` <rex_sources> on its own line, then one citation per line as resource|path|start_line|end_line, then </rex_sources> on its own line.` +
    ` Use only citations that are directly supported by the provided context.` +
    ` If the context is insufficient to answer, say so.`,
  );

  // Group summaries and chunks by resource_id
  const summaryByResource = new Map<string, SummaryRow[]>();
  for (const s of summaries) {
    const list = summaryByResource.get(s.resource_id) ?? [];
    list.push(s);
    summaryByResource.set(s.resource_id, list);
  }

  const chunksByResource = new Map<string, RetrievedChunk[]>();
  for (const c of chunks) {
    const list = chunksByResource.get(c.resource_id) ?? [];
    list.push(c);
    chunksByResource.set(c.resource_id, list);
  }

  for (const resource of resources) {
    parts.push(`\n[Resource: ${resource.name} (id: ${resource.id})]`);

    const resourceSummaries = summaryByResource.get(resource.id) ?? [];
    for (const s of resourceSummaries) {
      parts.push(`Summary (${s.block_type}):\n${s.content}`);
    }

    const resourceChunks = chunksByResource.get(resource.id) ?? [];
    for (const chunk of resourceChunks) {
      const lineLabel = Number.isFinite(chunk.start_line) && Number.isFinite(chunk.end_line)
        ? `lines ${chunk.start_line}-${chunk.end_line}, `
        : "";
      parts.push(
        `--- File: ${chunk.file_path} (${lineLabel}chunk ${chunk.chunk_index}) ---\n${chunk.text}`,
      );
    }
  }

  parts.push(`\n[Question]: ${question}`);

  return parts.join("\n\n");
}

export async function generateAnswer(
  resources: Resource[],
  summaries: SummaryRow[],
  chunks: RetrievedChunk[],
  question: string,
  providerConfig: ProviderConfig,
  providerOptions?: ProviderCallOptions,
): Promise<Answer> {
  const prompt = buildPrompt(resources, summaries, chunks, question);
  const provider = getProvider(providerConfig);
  const rawAnswer = await provider.call(prompt, providerOptions);
  const parsed = parseAnswerOutput(rawAnswer);
  const validatedSources = validateCitations(parsed.citations, chunks);

  return {
    answer: parsed.answer.trim(),
    sources: validatedSources,
  };
}

export async function generateSummaries(
  resource: Resource,
  chunkTexts: string[],
  providerConfig: ProviderConfig,
  onProgress?: (msg: string) => void,
): Promise<void> {
  const provider = getProvider(providerConfig);

  const fingerprints = [...new Set(chunkTexts.map((t) =>
    Buffer.from(t).toString("base64").slice(0, 8),
  ))];

  const context = chunkTexts.slice(0, 50).join("\n\n---\n\n");

  const summaryRows: Omit<SummaryRow, "id">[] = [];

  for (const blockType of SUMMARY_BLOCK_TYPES) {
    onProgress?.(`Generating ${blockType} summary...`);
    const prompt = buildSummaryPrompt(resource.name, blockType, context);
    const content = await provider.call(prompt);

    summaryRows.push({
      resource_id: resource.id,
      resource_name: resource.name,
      block_type: blockType,
      content: content.trim(),
      generated_at: new Date().toISOString(),
      based_on_fingerprints: JSON.stringify(fingerprints),
    });
  }

  await writeSummaries(summaryRows);
}

export function buildSummaryPrompt(
  resourceName: string,
  blockType: typeof SUMMARY_BLOCK_TYPES[number],
  context: string,
): string {
  const prompts: Record<typeof blockType, string> = {
    identity: `Based on the following code and documentation excerpts from "${resourceName}", write a concise identity summary (2-4 sentences) describing what this project is, what problem it solves, and who it is for.`,
    architecture: `Based on the following code and documentation excerpts from "${resourceName}", write a concise architecture summary (3-6 sentences) describing the main components, how they fit together, and key technical decisions.`,
    conventions: `Based on the following code and documentation excerpts from "${resourceName}", write a concise conventions summary (3-5 sentences) describing naming conventions, code style patterns, and structural norms used in this project.`,
  };

  return `${prompts[blockType]}\n\nContext:\n${context}\n\nSummary:`;
}

type ParsedCitation = {
  resource: string;
  path: string;
  lines?: [number, number];
};

function parseAnswerOutput(rawAnswer: string): {
  answer: string;
  citations: ParsedCitation[];
} {
  const match = rawAnswer.match(/<rex_sources>\s*([\s\S]*?)\s*<\/rex_sources>/i);
  if (!match) {
    return {
      answer: rawAnswer.trim(),
      citations: [],
    };
  }

  const block = match[1] ?? "";
  const citations = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCitationLine)
    .filter((citation): citation is ParsedCitation => citation !== null);

  return {
    answer: rawAnswer.replace(match[0], "").trim(),
    citations,
  };
}

function parseCitationLine(line: string): ParsedCitation | null {
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 4) return null;

  const [resource, path, startLine, endLine] = parts;
  if (!resource || !path) return null;

  if (parts.length === 2) {
    return { resource, path };
  }

  const start = Number.parseInt(startLine ?? "", 10);
  const end = Number.parseInt(endLine ?? "", 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return null;
  }

  return {
    resource,
    path,
    lines: [start, end],
  };
}

function validateCitations(
  citations: ParsedCitation[],
  chunks: RetrievedChunk[],
): Answer["sources"] {
  const grouped = new Map<string, RetrievedChunk[]>();
  for (const chunk of chunks) {
    const key = `${chunk.resource_name}::${chunk.file_path}`;
    const list = grouped.get(key) ?? [];
    list.push(chunk);
    grouped.set(key, list);
  }

  const validated = new Map<string, Answer["sources"][number]>();
  for (const citation of citations) {
    const key = `${citation.resource}::${citation.path}`;
    const matchingChunks = grouped.get(key) ?? [];
    if (matchingChunks.length === 0) continue;

    const lines = citation.lines ?? inferLinesFromChunks(matchingChunks);
    if (!lines) continue;
    if (!isLineRangeCovered(lines, matchingChunks)) continue;

    validated.set(`${key}::${lines[0]}-${lines[1]}`, {
      resource: citation.resource,
      path: citation.path,
      lines,
    });
  }

  return Array.from(validated.values());
}

function inferLinesFromChunks(chunks: RetrievedChunk[]): [number, number] | null {
  const starts = chunks.map((chunk) => chunk.start_line).filter(Number.isFinite);
  const ends = chunks.map((chunk) => chunk.end_line).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return null;
  return [Math.min(...starts), Math.max(...ends)];
}

function isLineRangeCovered(
  target: [number, number],
  chunks: RetrievedChunk[],
): boolean {
  const intervals = chunks
    .filter((chunk) => Number.isFinite(chunk.start_line) && Number.isFinite(chunk.end_line))
    .map((chunk) => [chunk.start_line, chunk.end_line] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  if (intervals.length === 0) return false;

  let current: [number, number] | null = null;
  for (const interval of intervals) {
    if (!current) {
      current = [...interval];
      continue;
    }
    if (interval[0] <= current[1] + 1) {
      current[1] = Math.max(current[1], interval[1]);
      continue;
    }
    if (target[0] >= current[0] && target[1] <= current[1]) {
      return true;
    }
    current = [...interval];
  }

  return current !== null && target[0] >= current[0] && target[1] <= current[1];
}
