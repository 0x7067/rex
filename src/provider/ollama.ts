import type { ProviderConfig } from "../core/resource.js";
import { ProviderError, type ProviderCallOptions } from "./interface.js";

interface OllamaResponse {
  response: string;
  done: boolean;
}

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
        body: JSON.stringify({ model: this.model, prompt, stream: false }),
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

    const data = (await response.json()) as OllamaResponse;
    return data.response;
  }
}
