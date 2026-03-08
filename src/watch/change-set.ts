import path from "node:path";
import { matchesAny, DEFAULT_EXCLUDES } from "../adapters/shared.js";

export type FileChange = {
  absolutePath: string;
  relativePath: string;
};

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
  ".db", ".sqlite",
]);

export function categorizeChange(
  _eventType: string,
  filename: string,
  rootDir: string,
  excludeRules: string[],
): FileChange | null {
  const ext = path.extname(filename).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return null;

  const absolutePath = path.resolve(rootDir, filename);
  const relativePath = path.relative(rootDir, absolutePath);

  const effectiveExcludes = [...DEFAULT_EXCLUDES, ...excludeRules];
  if (matchesAny(relativePath, effectiveExcludes)) return null;

  return { absolutePath, relativePath };
}
