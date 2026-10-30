import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { OllamaProvider } from "../../src/provider/ollama.js";
let server: http.Server;
let endpoint: string;
let response: unknown;
let received: unknown;
beforeEach(async () => {
  response = { response: "fixture answer", done: true };
  received = null;
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected TCP address");
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
describe("Ollama HTTP contract", () => {
  it("uses a bounded non-streaming generation request", async () => {
    const provider = new OllamaProvider({
      name: "ollama",
      model: "fixture-model",
      endpoint,
    });
    expect(await provider.call("supplied evidence")).toBe("fixture answer");
    expect(received).toEqual({
      model: "fixture-model",
      prompt: "supplied evidence",
      stream: false,
      options: { num_ctx: 8192, num_predict: 1024 },
    });
  });
  it("rejects malformed response data rather than returning an untyped value", async () => {
    response = { response: { wrong: "shape" }, done: true };
    await expect(
      new OllamaProvider({ name: "ollama", model: "fixture", endpoint }).call(
        "q",
      ),
    ).rejects.toThrow("malformed response");
  });
});
