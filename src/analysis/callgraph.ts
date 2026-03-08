import type { RetrievedChunk } from "../query/retriever.js";

export type CallGraphHit = {
  resource_name: string;
  file_path: string;
  line: number;
  context: string;
  kind: "call" | "definition" | "import";
};

const JS_TS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "instanceof",
  "new", "delete", "void", "throw", "await", "yield", "async", "function",
  "class", "import", "export", "from", "const", "let", "var", "of", "in",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findCallers(symbol: string, chunks: RetrievedChunk[]): CallGraphHit[] {
  const hits: CallGraphHit[] = [];
  const escaped = escapeRegex(symbol);

  const callPattern = new RegExp(`(?<![a-zA-Z0-9_$])${escaped}\\s*[(<]`);
  const importPattern = new RegExp(`\\bimport\\b[^;]*\\b${escaped}\\b`);
  const defPattern = new RegExp(
    `(?:function\\s+${escaped}\\b|(?:const|let|var)\\s+${escaped}\\s*=)`,
  );

  for (const chunk of chunks) {
    const lines = chunk.text.split("\n");
    const baseLineNum = isNaN(chunk.start_line) ? 0 : chunk.start_line;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (defPattern.test(line)) continue;

      const isCall = callPattern.test(line);
      const isImport = importPattern.test(line);
      if (isCall || isImport) {
        hits.push({
          resource_name: chunk.resource_name,
          file_path: chunk.file_path,
          line: baseLineNum + i,
          context: line.trim(),
          kind: isImport ? "import" : "call",
        });
      }
    }
  }

  return hits;
}

export function findCallees(symbol: string, chunks: RetrievedChunk[]): CallGraphHit[] {
  const hits: CallGraphHit[] = [];
  const escaped = escapeRegex(symbol);

  const defPattern = new RegExp(
    `(?:function\\s+${escaped}\\b|(?:const|let|var)\\s+${escaped}\\s*=)`,
  );
  const calleePattern = /\b([a-zA-Z_$][\w$]*)\s*\(/g;

  const seenCallees = new Set<string>();

  for (const chunk of chunks) {
    const lines = chunk.text.split("\n");
    const baseLineNum = isNaN(chunk.start_line) ? 0 : chunk.start_line;

    let defIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (defPattern.test(lines[i] ?? "")) {
        defIndex = i;
        break;
      }
    }
    if (defIndex === -1) continue;

    for (let i = defIndex + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      calleePattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = calleePattern.exec(line)) !== null) {
        const callee = match[1];
        if (!callee || JS_TS_KEYWORDS.has(callee) || seenCallees.has(callee)) continue;
        seenCallees.add(callee);
        hits.push({
          resource_name: chunk.resource_name,
          file_path: chunk.file_path,
          line: baseLineNum + i,
          context: line.trim(),
          kind: "call",
        });
      }
    }
  }

  return hits;
}
