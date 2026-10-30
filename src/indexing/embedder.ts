import {
  getLlama,
  LlamaLogLevel,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "node-llama-cpp";

export { EMBED_BATCH_SIZE } from "./embed-options.js";

const EMBED_MODEL =
  process.env["REX_EMBED_MODEL"] ?? "nomic-ai/nomic-embed-text-v1.5";
const GGUF_SOURCE =
  process.env["REX_GGUF_SOURCE"] ??
  "hf:nomic-ai/nomic-embed-text-v1.5-GGUF/nomic-embed-text-v1.5.Q8_0.gguf#0188c9bf409793f810680a5a431e7b899c46104c";
const EMBED_CONTEXT_SIZE = 4096;

export function getEmbeddingSource(): string {
  return GGUF_SOURCE;
}

export function documentInput(text: string): string {
  return `search_document: ${text}`;
}

let modelPromise: Promise<LlamaModel> | null = null;
let contextPromise: Promise<LlamaEmbeddingContext> | null = null;

async function getModel(): Promise<LlamaModel> {
  modelPromise ??= (async () => {
    const { resolveModelFile } = await import("node-llama-cpp");
    const llama = await getLlama({ logLevel: LlamaLogLevel.error });
    const modelPath = await resolveModelFile(GGUF_SOURCE, { cli: false });
    return llama.loadModel({ modelPath });
  })().catch((error: unknown) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

export function getEmbedModel(): string {
  return EMBED_MODEL;
}

export function getEmbedContextSize(): number {
  return EMBED_CONTEXT_SIZE;
}

export async function countTokens(text: string): Promise<number> {
  if (text.length === 0) return 0;
  return (await getContext()).calculateInputLength(documentInput(text));
}

async function getContext(): Promise<LlamaEmbeddingContext> {
  contextPromise ??= getModel()
    .then((loadedModel) =>
      loadedModel.createEmbeddingContext({
        contextSize: EMBED_CONTEXT_SIZE,
      }),
    )
    .catch((error: unknown) => {
      contextPromise = null;
      throw error;
    });
  return contextPromise;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const embeddingCtx = await getContext();
  const results = await Promise.all(
    texts.map((t) => embeddingCtx.getEmbeddingFor(documentInput(t))),
  );
  return results.map((r) => new Float32Array(r.vector));
}

export async function embedOne(text: string): Promise<Float32Array> {
  const embeddingCtx = await getContext();
  const result = await embeddingCtx.getEmbeddingFor(`search_query: ${text}`);
  if (!result.vector || result.vector.length === 0) {
    throw new Error("Embedding returned no results");
  }
  return new Float32Array(result.vector);
}

export async function disposeEmbedder(): Promise<void> {
  const context = await contextPromise?.catch(() => null);
  await context?.dispose();
  contextPromise = null;
  const model = await modelPromise?.catch(() => null);
  await model?.dispose();
  modelPromise = null;
}
