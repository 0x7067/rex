import type { ProviderConfig } from "../core/resource.js";
import { ClaudeProvider } from "./claude.js";
import { CodexProvider } from "./codex.js";
import { OllamaProvider } from "./ollama.js";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class RetryableProviderError extends ProviderError {
  constructor(
    message: string,
    providerName: string,
  ) {
    super(message, providerName);
    this.name = "RetryableProviderError";
  }
}

export interface ProviderCallOptions {
  profile?: "fast" | "clean";
}

export interface Provider {
  name: string;
  call(prompt: string, options?: ProviderCallOptions): Promise<string>;
}

export function getProvider(config: ProviderConfig): Provider {
  switch (config.name) {
    case "ollama":
      return new OllamaProvider(config);
    case "claude":
      return new ClaudeProvider(config);
    case "codex":
      return new CodexProvider(config);
  }
}
