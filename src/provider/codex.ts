import os from "node:os";
import { execa } from "execa";
import type { ProviderConfig } from "../core/resource.js";
import {
  ProviderError,
  RetryableProviderError,
  type ProviderCallOptions,
} from "./interface.js";

const CODEX_EXEC_ROOT = os.tmpdir();

const META_PREFIX_PATTERNS = [
  /^(?:I['’]m|I am)\s+/i,
  /^Using `[^`]+`/i,
  /^The sandbox\b/i,
  /^Loading\b/i,
  /^Checking\b/i,
];

const META_KEYWORDS =
  /\b(?:skill|skills|sandbox|workspace instructions|repo workflow|session instructions|startup|tool call|tooling|superpowers)\b/i;

export class CodexProvider {
  readonly name = "codex";
  private model: string | null;

  constructor(config: ProviderConfig) {
    this.model = config.model;
  }

  async call(prompt: string, options: ProviderCallOptions = {}): Promise<string> {
    const profile = options.profile ?? "fast";
    const args = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "-C",
      CODEX_EXEC_ROOT,
    ];
    if (this.model) args.push("--model", this.model);

    let result: { stdout: string };
    try {
      result = await execa("codex", args, {
        input: buildCodexPrompt(prompt, profile),
        timeout: profile === "fast" ? 90_000 : 120_000,
      });
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ProviderError(
          "codex binary not found on PATH. Install Codex CLI from OpenAI.",
          "codex",
        );
      }
      throw new ProviderError(
        `codex CLI failed: ${err instanceof Error ? err.message : String(err)}`,
        "codex",
      );
    }

    const rawAnswer = extractFinalAgentMessage(result.stdout) ?? result.stdout;
    const cleaned = sanitizeCodexAnswer(rawAnswer);

    if (!cleaned) {
      if (profile === "fast") {
        throw new RetryableProviderError(
          "codex returned only setup chatter",
          "codex",
        );
      }
      throw new ProviderError("codex returned no usable answer", "codex");
    }

    return cleaned;
  }
}

function buildCodexPrompt(
  prompt: string,
  profile: NonNullable<ProviderCallOptions["profile"]>,
): string {
  const instruction = profile === "fast"
    ? [
      "You are the answer backend for a CLI question-answering command.",
      "Return only the final answer body.",
      "Do not mention skills, tools, sandboxing, workflow, setup, or what you are about to do.",
      "If context is insufficient, say so directly without meta commentary.",
    ].join(" ")
    : [
      "You are the answer backend for a CLI question-answering command.",
      "Return only the final grounded answer.",
      "Never mention repo instructions, skills, tools, sandboxing, startup, or internal workflow.",
      "If context is insufficient, say so directly and briefly.",
    ].join(" ");

  return `${instruction}\n\n${prompt}`;
}

function extractFinalAgentMessage(stdout: string): string | null {
  const lines = stdout.trim().split("\n").filter(Boolean);
  let finalMessage: string | null = null;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event["type"] !== "item.completed") continue;
      const item = event["item"] as Record<string, unknown> | undefined;
      if (item?.["type"] === "agent_message" && typeof item["text"] === "string") {
        finalMessage = item["text"];
      }
    } catch {
      // Ignore non-JSON lines from the CLI.
    }
  }

  return finalMessage;
}

function sanitizeCodexAnswer(answer: string): string {
  let lines = answer
    .split("\n")
    .map((line) => stripInlineMetaPrefix(line.trim()))
    .filter(Boolean);

  while (lines.length > 0 && isMetaLine(lines[0] ?? "")) {
    lines = lines.slice(1);
  }

  if (lines.length === 0) return "";

  const sanitized = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return isMetaOnlyAnswer(sanitized) ? "" : sanitized;
}

function stripInlineMetaPrefix(line: string): string {
  if (!/^Using `[^`]+`/i.test(line)) return line;
  const commaIndex = line.indexOf(",");
  if (commaIndex === -1) return line;
  return line.slice(commaIndex + 1).trim();
}

function isMetaLine(line: string): boolean {
  return META_PREFIX_PATTERNS.some((pattern) => pattern.test(line))
    && META_KEYWORDS.test(line);
}

function isMetaOnlyAnswer(answer: string): boolean {
  if (answer.length === 0) return true;
  const lines = answer.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((line) => isMetaLine(line) || META_KEYWORDS.test(line));
}
