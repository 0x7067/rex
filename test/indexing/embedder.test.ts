import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-llama-cpp", () => ({
  getLlama: vi.fn(),
  LlamaLogLevel: {
    error: "error",
  },
  resolveModelFile: vi.fn(),
}));

function makeChain(vectors: number[][]) {
  let callIndex = 0;
  const getEmbeddingFor = vi.fn().mockImplementation(async () => ({
    vector: vectors[callIndex++] ?? [],
  }));
  const calculateInputLength = vi.fn(
    (text: string) => text.split(/\s+/).filter(Boolean).length + 2,
  );
  const ctx = { getEmbeddingFor, calculateInputLength };
  const tokenize = vi
    .fn()
    .mockImplementation((text: string) =>
      Array.from(
        { length: text.split(/\s+/).filter(Boolean).length },
        (_, index) => index + 1,
      ),
    );
  const model = {
    createEmbeddingContext: vi.fn().mockResolvedValue(ctx),
    tokenize,
  };
  const llama = { loadModel: vi.fn().mockResolvedValue(model) };
  return { llama, getEmbeddingFor, tokenize, calculateInputLength };
}

async function loadEmbedder() {
  const mod = await import("../../src/indexing/embedder.js");
  const llc = await import("node-llama-cpp");
  return { ...mod, mocks: vi.mocked(llc) };
}

describe("getEmbedModel", () => {
  it("defaults to nomic-ai/nomic-embed-text-v1.5", async () => {
    const { getEmbedModel } = await loadEmbedder();
    expect(getEmbedModel()).toBe("nomic-ai/nomic-embed-text-v1.5");
  });
});

describe("embed", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns empty array for empty input without calling getLlama", async () => {
    const { embed, mocks } = await loadEmbedder();
    expect(await embed([])).toEqual([]);
    expect(mocks.getLlama).not.toHaveBeenCalled();
  });

  it("calls createEmbeddingContext with contextSize: 2048", async () => {
    const { embed, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama } = makeChain([[0.1, 0.2, 0.3]]);
    mocks.getLlama.mockResolvedValue(llama);

    await embed(["hello"]);
    expect(mocks.getLlama).toHaveBeenCalledWith({
      logLevel: "error",
    });
    const model = await llama.loadModel.mock.results[0]?.value;
    expect(model.createEmbeddingContext).toHaveBeenCalledWith({
      contextSize: 4096,
    });
  });

  it("calls getEmbeddingFor and returns Float32Array[] for single text", async () => {
    const { embed, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama, getEmbeddingFor } = makeChain([[0.1, 0.2, 0.3]]);
    mocks.getLlama.mockResolvedValue(llama);

    const result = await embed(["hello"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result[0]!)).toEqual(
      Array.from(new Float32Array([0.1, 0.2, 0.3])),
    );
    expect(getEmbeddingFor).toHaveBeenCalledWith("search_document: hello");
  });

  it("returns multiple Float32Arrays for multiple texts", async () => {
    const { embed, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama, getEmbeddingFor } = makeChain([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    mocks.getLlama.mockResolvedValue(llama);

    const result = await embed(["a", "b"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(result[1]).toBeInstanceOf(Float32Array);
    expect(getEmbeddingFor).toHaveBeenCalledTimes(2);
  });
});

describe("embedOne", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a single Float32Array for one text", async () => {
    const { embedOne, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama } = makeChain([[0.5, 0.6, 0.7]]);
    mocks.getLlama.mockResolvedValue(llama);

    const result = await embedOne("hello");
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual(
      Array.from(new Float32Array([0.5, 0.6, 0.7])),
    );
  });

  it("throws when embedding returns no results", async () => {
    const { embedOne, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama } = makeChain([[]]);
    mocks.getLlama.mockResolvedValue(llama);

    await expect(embedOne("hello")).rejects.toThrow(
      "Embedding returned no results",
    );
  });
});

describe("countTokens", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uses the loaded model tokenizer for token-aware chunk sizing", async () => {
    const { countTokens, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama, calculateInputLength } = makeChain([[0.5]]);
    mocks.getLlama.mockResolvedValue(llama);

    await expect(countTokens("alpha beta gamma")).resolves.toBe(6);
    expect(calculateInputLength).toHaveBeenCalledWith(
      "search_document: alpha beta gamma",
    );
  });
});

describe("embedding initialization", () => {
  beforeEach(() => vi.resetModules());
  it("shares one native model and context across concurrent first queries", async () => {
    const { embedOne, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama, getEmbeddingFor } = makeChain([[1], [2]]);
    mocks.getLlama.mockResolvedValue(llama);
    await Promise.all([embedOne("first"), embedOne("second")]);
    expect(mocks.getLlama).toHaveBeenCalledOnce();
    const loaded = await llama.loadModel.mock.results[0]?.value;
    expect(loaded.createEmbeddingContext).toHaveBeenCalledOnce();
    expect(getEmbeddingFor).toHaveBeenCalledWith("search_query: first");
  });
  it("retries initialization after a transient native load failure", async () => {
    const { embedOne, mocks } = await loadEmbedder();
    mocks.resolveModelFile.mockResolvedValue("/fake/model.gguf");
    const { llama } = makeChain([[1]]);
    mocks.getLlama
      .mockRejectedValueOnce(new Error("temporary load failure"))
      .mockResolvedValue(llama);
    await expect(embedOne("first")).rejects.toThrow("temporary load failure");
    await expect(embedOne("second")).resolves.toEqual(new Float32Array([1]));
  });
});
