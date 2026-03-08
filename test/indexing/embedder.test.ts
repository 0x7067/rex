import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock global fetch before importing embedder
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocking
const { embed, embedOne } = await import("../../src/indexing/embedder.js");

function makeOllamaResponse(embeddings: number[][]): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ embeddings }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

describe("embed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for empty input without calling fetch", async () => {
    const result = await embed([]);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls Ollama /api/embed and returns Float32Array[] for single text", async () => {
    mockFetch.mockResolvedValue(makeOllamaResponse([[0.1, 0.2, 0.3]]));

    const result = await embed(["hello"]);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/embed"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(result[0]!)).toEqual(
      Array.from(new Float32Array([0.1, 0.2, 0.3])),
    );
  });

  it("returns multiple Float32Arrays for multiple texts", async () => {
    mockFetch.mockResolvedValue(
      makeOllamaResponse([
        [0.1, 0.2],
        [0.3, 0.4],
      ]),
    );

    const result = await embed(["hello", "world"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Float32Array);
    expect(result[1]).toBeInstanceOf(Float32Array);
  });

  it("throws when Ollama returns a non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as unknown as Response);

    await expect(embed(["hello"])).rejects.toThrow(
      /Ollama embed failed: HTTP 500/,
    );
  });

  it("throws a clear not-running error when fetch fails to connect", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    await expect(embed(["hello"])).rejects.toThrow(
      /Ollama is not running/,
    );
  });
});

describe("embedOne", () => {
  it("returns a single Float32Array for one text", async () => {
    mockFetch.mockResolvedValue(makeOllamaResponse([[0.5, 0.6, 0.7]]));

    const result = await embedOne("hello");
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.from(result)).toEqual(
      Array.from(new Float32Array([0.5, 0.6, 0.7])),
    );
  });

  it("throws when embedding returns no results", async () => {
    mockFetch.mockResolvedValue(makeOllamaResponse([]));

    await expect(embedOne("hello")).rejects.toThrow(
      "Embedding returned no results",
    );
  });
});
