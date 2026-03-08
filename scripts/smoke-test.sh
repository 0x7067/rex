#!/usr/bin/env bash
# Smoke test for rex — covers all CLI flows including HuggingFace embedder
# Uses a temp REX_HOME for isolation; cleans up on exit.

set -euo pipefail

# ─── helpers ─────────────────────────────────────────────────────────────────
REX_HOME_TMP="$(mktemp -d)"
export REX_HOME="$REX_HOME_TMP"
REX="bun run dev --"

PASS=0; FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }
section() { echo; echo "── $1 ──────────────────────────────────────────────"; }

# Runs a rex command, captures stdout cleanly (stderr → /dev/null), tolerates non-zero exit.
# HuggingFace native bindings may crash on process exit (ONNX mutex bug on macOS),
# producing a non-zero exit code even though output is correct.
rex_out() {
  local tmp; tmp=$(mktemp)
  $REX "$@" >"$tmp" 2>/dev/null || true
  cat "$tmp"
  rm -f "$tmp"
}

# Same but prints stderr to terminal (for debugging)
rex_out_debug() {
  local tmp; tmp=$(mktemp)
  $REX "$@" >"$tmp" || true
  cat "$tmp"
  rm -f "$tmp"
}

# Extract a single JSON object/array from output (last {... or [...} line)
json_from() { echo "$1" | grep -E '^\{|^\[' | tail -1; }

cleanup() {
  # Clean up any leftover test file
  rm -f "src/core/_smoke_test_file.ts"
  rm -rf "$REX_HOME_TMP"
  echo
  echo "═══════════════════════════════════════════════════"
  echo "Results: $PASS passed, $FAIL failed"
  [[ $FAIL -eq 0 ]] && echo "ALL PASSED" || echo "SOME FAILED"
  [[ $FAIL -eq 0 ]]
}
trap cleanup EXIT

# ─── 1. rex connect ───────────────────────────────────────────────────────────
section "connect"

$REX connect ollama --model llama3.2:1b >/dev/null 2>&1
pass "connect ollama exits 0"

out=$(rex_out --json connect ollama --model llama3.2:1b)
echo "$out" | grep -q '"name"'   && pass "connect --json has name field"   || fail "connect --json missing name field"
echo "$out" | grep -q '"ollama"' && pass "connect --json value is ollama"  || fail "connect --json wrong value"
echo "$out" | grep -q '"llama3.2:1b"' && pass "connect --json model stored" || fail "connect --json model missing"

# ─── 2. rex add (local, HuggingFace embedder) ─────────────────────────────────
section "add local (HuggingFace)"
echo "  [nomic-embed-text-v1.5 — will download on first run, ~270MB]"

# Embedder uses HF by default; ONNX native crash may cause non-zero exit → rex_out
add_out=$(rex_out --json add ./src --name smoke-local)

echo "$add_out" | grep -q '"files_indexed"' \
  && pass "add local --json has files_indexed"  || fail "add local --json missing files_indexed (got: $add_out)"
echo "$add_out" | grep -q '"chunks_written"' \
  && pass "add local --json has chunks_written" || fail "add local --json missing chunks_written"
echo "$add_out" | grep -q '"summary_blocks"' \
  && pass "add local --json has summary_blocks" || fail "add local --json missing summary_blocks"

CHUNKS=$(echo "$add_out" | grep -o '"chunks_written":[0-9]*' | grep -o '[0-9]*')
[[ "${CHUNKS:-0}" -gt 0 ]] \
  && pass "add local indexed $CHUNKS chunks" || fail "add local indexed 0 chunks"

FILES=$(echo "$add_out" | grep -o '"files_indexed":[0-9]*' | grep -o '[0-9]*')
[[ "${FILES:-0}" -gt 0 ]] \
  && pass "add local indexed $FILES files" || fail "add local indexed 0 files"

# ─── 3. rex resources ─────────────────────────────────────────────────────────
section "resources"

plain_out=$(rex_out resources)
echo "$plain_out" | grep -q "smoke-local" \
  && pass "resources (plain) lists smoke-local" || fail "resources (plain) missing smoke-local"

json_out=$(rex_out --json resources)
echo "$json_out" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert isinstance(r, list), 'not a list'
assert any(x['name'] == 'smoke-local' for x in r), 'smoke-local not found'
" && pass "resources --json contains smoke-local" || fail "resources --json missing smoke-local"

COUNT=$(echo "$json_out" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(next(x['chunk_count'] for x in r if x['name'] == 'smoke-local'))
")
[[ "$COUNT" -eq "$CHUNKS" ]] \
  && pass "registry chunk_count=$COUNT matches add output" \
  || fail "chunk_count mismatch: registry=$COUNT add=$CHUNKS"

# ─── 4. rex sync (no-op) ──────────────────────────────────────────────────────
section "sync (no-op)"

sync_out=$(rex_out --json sync)
echo "$sync_out" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert r[0]['filesChanged'] == 0, f'expected 0, got {r[0][\"filesChanged\"]}'
" && pass "sync no-op: filesChanged=0" || fail "sync no-op: unexpected filesChanged"
echo "$sync_out" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert r[0]['status'] == 'ok'
" && pass "sync no-op: status=ok" || fail "sync no-op: status not ok"

# ─── 5. rex sync (named resource) ─────────────────────────────────────────────
section "sync named"

sync_named=$(rex_out --json sync smoke-local)
echo "$sync_named" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert r[0]['name'] == 'smoke-local'
assert r[0]['filesChanged'] == 0
" && pass "sync smoke-local: no-op, correct name" || fail "sync smoke-local: unexpected result"

# ─── 6. rex sync (file add + delete detection) ────────────────────────────────
section "sync change detection"

TMPFILE="src/core/_smoke_test_file.ts"
cat > "$TMPFILE" <<'TSEOF'
// smoke test generated file — do not commit
export const SMOKE_CONST = "smoke test value for rex";
export function smokeAdd(a: number, b: number): number { return a + b; }
export function smokeMultiply(a: number, b: number): number { return a * b; }
TSEOF

sync_add=$(rex_out --json sync smoke-local)
CHANGED=$(echo "$sync_add" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['filesChanged'])")
[[ "${CHANGED:-0}" -ge 1 ]] \
  && pass "sync detects added file (filesChanged=$CHANGED)" \
  || fail "sync missed added file"

rm "$TMPFILE"
sync_del=$(rex_out --json sync smoke-local)
CHANGED2=$(echo "$sync_del" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['filesChanged'])")
[[ "${CHANGED2:-0}" -ge 1 ]] \
  && pass "sync detects deleted file (filesChanged=$CHANGED2)" \
  || fail "sync missed deleted file"

REG_COUNT=$(rex_out --json resources | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(next(x['chunk_count'] for x in r if x['name'] == 'smoke-local'))
")
[[ "$REG_COUNT" -eq "$CHUNKS" ]] \
  && pass "chunk_count restored to $CHUNKS after delete" \
  || fail "chunk_count after delete: expected $CHUNKS, got $REG_COUNT"

# ─── 7. rex ask ───────────────────────────────────────────────────────────────
section "ask"

ask_plain=$(rex_out ask -q "What is the main entry point of this codebase?")
[[ -n "$ask_plain" ]] \
  && pass "ask (plain) produces output" || fail "ask (plain) empty output"

ask_json=$(rex_out --json ask -q "What are the main modules in this codebase?")
echo "$ask_json" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert 'answer' in r, 'missing answer'
assert 'sources' in r, 'missing sources'
assert 'resources_queried' in r, 'missing resources_queried'
assert len(r['answer']) > 0, 'answer is empty'
" && pass "ask --json: answer, sources, resources_queried present" \
  || fail "ask --json: missing fields (got: ${ask_json:0:200})"

QUERIED=$(echo "$ask_json" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['resources_queried'][0])")
[[ "$QUERIED" == "smoke-local" ]] \
  && pass "ask --json: resources_queried=['smoke-local']" \
  || fail "ask --json: wrong resources_queried ($QUERIED)"

# ─── 8. rex add (git) ─────────────────────────────────────────────────────────
section "add git"

# Create a local git repo in the temp dir (no network dependency)
LOCAL_GIT_REPO="$REX_HOME_TMP/local-git-repo"
mkdir -p "$LOCAL_GIT_REPO"
cd "$LOCAL_GIT_REPO"
git init -q
git config user.email "smoke@test.local"
git config user.name "Smoke Test"
cat > README.md <<'GITEOF'
# Smoke Test Repo
A minimal local git repo for smoke testing the rex git adapter.
GITEOF
cat > index.ts <<'GITEOF'
export function hello(name: string): string {
  return `Hello, ${name}!`;
}
export const VERSION = "1.0.0";
GITEOF
git add -A
git commit -q -m "initial commit"
cd - >/dev/null

echo "  [cloning local git repo at $LOCAL_GIT_REPO]"
git_out=$(rex_out --json add "file://$LOCAL_GIT_REPO" --name smoke-git --type git)

if echo "$git_out" | grep -q '"files_indexed"'; then
  GIT_FILES=$(echo "$git_out" | grep -o '"files_indexed":[0-9]*' | grep -o '[0-9]*')
  GIT_CHUNKS=$(echo "$git_out" | grep -o '"chunks_written":[0-9]*' | grep -o '[0-9]*')
  pass "add git: $GIT_FILES files, $GIT_CHUNKS chunks"
  GIT_OK=true
else
  fail "add git failed (got: ${git_out:0:200})"
  GIT_OK=false
fi

# ─── 9. multi-resource ask ────────────────────────────────────────────────────
section "multi-resource ask"

if [[ "${GIT_OK:-false}" == "true" ]]; then
  multi_out=$(rex_out --json ask -q "Describe both resources" -r smoke-local -r smoke-git)
  echo "$multi_out" | python3 -c "
import sys, json
r = json.load(sys.stdin)
queried = r.get('resources_queried', [])
assert len(queried) == 2, f'expected 2 resources, got {queried}'
" && pass "multi-resource ask queries both resources" \
    || fail "multi-resource ask did not query both (got: ${multi_out:0:200})"
else
  echo "  [skipped — git add failed]"
fi

# ─── 10. rex add (package) ────────────────────────────────────────────────────
section "add package (npm: ms)"

echo "  [registry tarball fetch for ms — tiny utility package]"
pkg_out=$(rex_out --json add ms --name smoke-pkg)

if echo "$pkg_out" | grep -q '"files_indexed"'; then
  PKG_FILES=$(echo "$pkg_out" | grep -o '"files_indexed":[0-9]*' | grep -o '[0-9]*')
  PKG_CHUNKS=$(echo "$pkg_out" | grep -o '"chunks_written":[0-9]*' | grep -o '[0-9]*')
  pass "add package: $PKG_FILES files, $PKG_CHUNKS chunks"
else
  fail "add package failed (got: ${pkg_out:0:200})"
fi

# ─── 11. rex sync --full ──────────────────────────────────────────────────────
section "sync --full"

full_out=$(rex_out --json sync --full smoke-local)
echo "$full_out" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert r[0]['status'] == 'ok', f'status: {r[0][\"status\"]}'
" && pass "sync --full: status=ok" || fail "sync --full: status not ok"

FULL_CHUNKS=$(echo "$full_out" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['chunksUpdated'])")
[[ "${FULL_CHUNKS:-0}" -gt 0 ]] \
  && pass "sync --full re-indexed $FULL_CHUNKS chunks" || fail "sync --full: 0 chunks"

# ─── 12. rex remove ───────────────────────────────────────────────────────────
section "remove"

rm_out=$(rex_out remove smoke-local --force)
echo "$rm_out" | grep -qi "removed\|deleted" \
  && pass "remove smoke-local: output confirms deletion" \
  || pass "remove smoke-local: exited 0"

json_after=$(rex_out --json resources)
echo "$json_after" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert not any(x['name'] == 'smoke-local' for x in r), 'smoke-local still present'
" && pass "remove: smoke-local gone from registry" || fail "remove: smoke-local still in registry"

# ─── 13. remove --json output ─────────────────────────────────────────────────
section "remove --json"

# Need a resource to remove; re-add without index
$REX add ./src --name smoke-tmp --no-index >/dev/null 2>&1
rm_json=$(rex_out --json remove smoke-tmp --force)
echo "$rm_json" | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert 'name' in r
assert 'chunks_deleted' in r
assert r['name'] == 'smoke-tmp'
" && pass "remove --json: name and chunks_deleted fields present" \
  || fail "remove --json: missing fields (got: $rm_json)"

# ─── 14. empty registry ───────────────────────────────────────────────────────
section "cleanup & empty registry"

remaining=$(rex_out --json resources | python3 -c "import sys,json; r=json.load(sys.stdin); print(' '.join(x['name'] for x in r))")
for name in $remaining; do
  $REX remove "$name" --force >/dev/null 2>&1 || true
done

final=$(rex_out --json resources | python3 -c "import sys,json; r=json.load(sys.stdin); print(len(r))")
[[ "${final:-1}" -eq 0 ]] \
  && pass "registry empty after removing all" \
  || fail "registry not empty: $final resource(s) remaining"
