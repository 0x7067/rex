import type { Command } from "commander";
import { setProvider } from "../core/registry.js";
import { ProviderConfigSchema, type ProviderName } from "../core/resource.js";

export function registerConnect(program: Command): void {
  program
    .command("connect <provider>")
    .description("Configure the active LLM provider (ollama, claude, codex)")
    .option("--model <model>", "Model name or override")
    .option("--endpoint <url>", "Custom API endpoint (ollama only)")
    .action((provider: string, options: { model?: string; endpoint?: string }) => {
      const defaultModel = provider === "claude" ? "haiku" : null;
      const parsed = ProviderConfigSchema.safeParse({
        name: provider,
        model: options.model ?? defaultModel,
        endpoint: options.endpoint ?? null,
      });

      if (!parsed.success) {
        console.error(
          `Unknown provider: "${provider}". Valid options: ollama, claude, codex`,
        );
        process.exit(1);
      }

      setProvider(parsed.data);

      if (program.opts()["json"]) {
        console.log(JSON.stringify(parsed.data, null, 2));
      } else {
        const parts = [`Provider set: ${parsed.data.name}`];
        if (parsed.data.model) parts.push(`model: ${parsed.data.model}`);
        if (parsed.data.endpoint) parts.push(`endpoint: ${parsed.data.endpoint}`);
        console.log(parts.join(", "));
      }
    });
}
