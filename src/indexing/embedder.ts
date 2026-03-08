import {
  getLlama,
  LlamaLogLevel,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "node-llama-cpp";

export { EMBED_BATCH_SIZE } from "./embed-options.js";

const EMBED_MODEL = process.env["REX_EMBED_MODEL"] ?? "nomic-ai/nomic-embed-text-v1.5";
const GGUF_SOURCE =
  process.env["REX_GGUF_SOURCE"] ?? "hf:nomic-ai/nomic-embed-text-v1.5-GGUF:Q8_0";
const EMBED_CONTEXT_SIZE = 4096;

let model: LlamaModel | null = null;
let ctx: LlamaEmbeddingContext | null = null;

async function getModel(): Promise<LlamaModel> {
  if (!model) {
    const { resolveModelFile } = await import("node-llama-cpp");
    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const modelPath = await resolveModelFile(GGUF_SOURCE);
    model = await llama.loadModel({ modelPath });
  }
  return model;
}

export function getEmbedModel(): string {
  return EMBED_MODEL;
}

export function getEmbedContextSize(): number {
  return EMBED_CONTEXT_SIZE;
}

export async function countTokens(text: string): Promise<number> {
  if (text.length === 0) return 0;
  const loadedModel = await getModel();
  return loadedModel.tokenize(text).length;
}

async function getContext(): Promise<LlamaEmbeddingContext> {
  if (!ctx) {
    const loadedModel = await getModel();
    ctx = await loadedModel.createEmbeddingContext({ contextSize: EMBED_CONTEXT_SIZE });
  }
  return ctx;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const embeddingCtx = await getContext();
  const results = await Promise.all(texts.map((t) => embeddingCtx.getEmbeddingFor(t)));
  return results.map((r) => new Float32Array(r.vector));
}

export async function embedOne(text: string): Promise<Float32Array> {
  const embeddingCtx = await getContext();
  const result = await embeddingCtx.getEmbeddingFor(text);
  if (!result.vector || result.vector.length === 0) {
    throw new Error("Embedding returned no results");
  }
  return new Float32Array(result.vector);
}
