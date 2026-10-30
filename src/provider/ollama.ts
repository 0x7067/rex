import type { ProviderConfig } from "../core/resource.js";
import { ProviderError, type ProviderCallOptions } from "./interface.js";
import { z } from "zod";

export class OllamaProvider {
  readonly name = "ollama";
  private endpoint: string;
  private model: string;

  constructor(config: ProviderConfig) {
    this.endpoint = config.endpoint ?? "http://localhost:11434";
    this.model = config.model ?? "llama3";
  }

  async call(prompt: string, _options?: ProviderCallOptions): Promise<string> {
    const url = `${this.endpoint}/api/generate`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: { num_ctx: 8192, num_predict: 1024 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new ProviderError(
        `Ollama connection failed (${url}): ${err instanceof Error ? err.message : String(err)}`,
        "ollama",
      );
    }

    if (!response.ok) {
      throw new ProviderError(
        `Ollama returned HTTP ${response.status}: ${await response.text()}`,
        "ollama",
      );
    }

    const data = z
      .object({ response: z.string().min(1), done: z.boolean() })
      .safeParse(await response.json());
    if (!data.success)
      throw new ProviderError("Ollama returned a malformed response", "ollama");
    return data.data.response;
  }
}
