/**
 * Embedder: uses Ollama's /api/embed endpoint for local inference.
 * Override endpoint/model via REX_OLLAMA_ENDPOINT and REX_EMBED_MODEL env vars.
 */

export { EMBED_BATCH_SIZE } from "./embed-options.js";

const OLLAMA_ENDPOINT =
  process.env["REX_OLLAMA_ENDPOINT"] ?? "http://localhost:11434";
const OLLAMA_EMBED_MODEL =
  process.env["REX_EMBED_MODEL"] ?? "nomic-embed-text";

export function getEmbedModel(): string {
  return OLLAMA_EMBED_MODEL;
}

export function getEmbedEndpoint(): string {
  return OLLAMA_ENDPOINT;
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_ENDPOINT}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
    });
  } catch (err) {
    throw new Error(
      `Ollama is not running or unreachable at ${OLLAMA_ENDPOINT}. ` +
      `Start Ollama and try again. (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `Ollama embed failed: HTTP ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as { embeddings: number[][] };
  return data.embeddings.map((vec) => new Float32Array(vec));
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [vec] = await embed([text]);
  if (!vec) throw new Error("Embedding returned no results");
  return vec;
}
