import os from "node:os";
import { execa } from "execa";
import type { ProviderConfig } from "../core/resource.js";
import { ProviderError, type ProviderCallOptions } from "./interface.js";

const CLAUDE_EXEC_ROOT = os.tmpdir();

export class ClaudeProvider {
  readonly name = "claude";
  private model: string | null;

  constructor(config: ProviderConfig) {
    this.model = config.model;
  }

  async call(prompt: string, _options?: ProviderCallOptions): Promise<string> {
    const args = [
      "-p",
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
      "--no-session-persistence",
    ];
    if (this.model) args.push("--model", this.model);

    let result: { stdout: string };
    try {
      result = await execa("claude", args, {
        cwd: CLAUDE_EXEC_ROOT,
        input: prompt,
        timeout: 120_000,
      });
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProviderError(
          "claude binary not found on PATH. Install Claude Code: https://claude.ai/code",
          "claude",
        );
      }
      throw new ProviderError(
        `claude CLI failed: ${err instanceof Error ? err.message : String(err)}`,
        "claude",
      );
    }

    // Parse JSON output from claude --output-format json
    try {
      const parsed = JSON.parse(result.stdout) as { result?: string; content?: Array<{ type: string; text: string }> };
      if (parsed.result) return parsed.result;
      if (parsed.content) {
        return parsed.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
      }
    } catch {
      // Not JSON, return raw
    }

    return result.stdout;
  }
}
