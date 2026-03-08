import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import type { FileEntry } from "./adapter.js";

export const DEFAULT_EXCLUDES = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/*.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".db", ".sqlite",
]);

function isBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function matchesAny(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    minimatch(relativePath, pattern, { dot: true }),
  );
}

export async function* enumerate(
  dir: string,
  includeRules: string[],
  excludeRules: string[],
): AsyncGenerator<FileEntry> {
  const effectiveExcludes = [
    ...DEFAULT_EXCLUDES,
    ...excludeRules,
  ];

  const walk = async function* (currentDir: string): AsyncGenerator<FileEntry> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(dir, absolutePath);

      if (matchesAny(relativePath, effectiveExcludes)) continue;

      if (entry.isDirectory()) {
        yield* walk(absolutePath);
      } else if (entry.isFile()) {
        if (isBinary(entry.name)) continue;

        if (includeRules.length > 0 && !matchesAny(relativePath, includeRules)) {
          continue;
        }

        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(absolutePath).size;
        } catch {
          continue;
        }

        yield { absolutePath, relativePath, sizeBytes };
      }
    }
  };

  yield* walk(dir);
}

export async function fingerprint(entry: FileEntry): Promise<string> {
  const content = fs.readFileSync(entry.absolutePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}
