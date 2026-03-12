import type { Command } from "commander";
import { setProvider } from "../core/registry.js";
import { ProviderConfigSchema } from "../core/resource.js";
import { addExamples } from "./help.js";

export function registerConnect(program: Command): void {
  addExamples(
    program
    .command("connect <provider>")
    .description("Configure the active answer provider (claude, codex, ollama)")
    .option("--model <model>", "Model name or override")
    .option("--endpoint <url>", "Custom API endpoint (ollama only)"),
    ["rex connect claude", "rex connect ollama --model llama3"],
  )
    .action((provider: string, options: { model?: string; endpoint?: string }) => {
      const defaultModel = provider === "claude" ? "haiku" : null;
      const parsed = ProviderConfigSchema.safeParse({
        name: provider,
        model: options.model ?? defaultModel,
        endpoint: options.endpoint ?? null,
      });

      if (!parsed.success) {
        console.error(`Unknown provider "${provider}". Choose one of: claude, codex, ollama.`);
        console.error("Example: rex connect claude");
        process.exit(1);
      }

      setProvider(parsed.data);

      if (program.opts()["json"]) {
        console.log(JSON.stringify(parsed.data, null, 2));
      } else {
        const details = [
          parsed.data.model ? `model: ${parsed.data.model}` : null,
          parsed.data.endpoint ? `endpoint: ${parsed.data.endpoint}` : null,
        ].filter(Boolean).join(", ");
        console.log(
          details
            ? `Provider configured: ${parsed.data.name} (${details})`
            : `Provider configured: ${parsed.data.name}`,
        );
        console.log("Next: rex add ./some-project");
      }
    });
}
