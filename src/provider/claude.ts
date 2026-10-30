import os from "node:os";
import { execa } from "execa";
import { z } from "zod";
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
      "--tools",
      "",
      "--disallowedTools",
      "mcp__*",
      "--safe-mode",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--settings",
      '{"disableAllHooks":true}',
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
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
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

    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      throw new ProviderError("claude returned invalid JSON", "claude");
    }
    const parsed = z
      .object({
        result: z.string().optional(),
        is_error: z.boolean().optional(),
        content: z
          .array(z.object({ type: z.string(), text: z.string().optional() }))
          .optional(),
      })
      .safeParse(value);
    if (!parsed.success || parsed.data.is_error)
      throw new ProviderError(
        "claude returned an error or malformed response",
        "claude",
      );
    const answer =
      parsed.data.result ??
      parsed.data.content
        ?.filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n");
    if (!answer?.trim())
      throw new ProviderError("claude returned no answer", "claude");
    return answer;
  }
}
