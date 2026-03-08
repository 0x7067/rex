# Releasing Rex

`rex` is currently distributed as the scoped alpha package `@denguinho/rex`.

## Before You Publish

1. Confirm the package version in `package.json` is the version you want to release.
2. Run the local verification flow:

```bash
bun install
bun run test
bun run build
node dist/bin/rex.js --help
REX_HOME=/tmp/rex-release-smoke node dist/bin/rex.js resources --json
NPM_CONFIG_CACHE=/tmp/rex-npm-cache npm pack --dry-run
```

3. Make sure the repository secret `NPM_TOKEN` is configured for GitHub Actions.

## Publish Paths

- Tag push:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

  This triggers `.github/workflows/release.yml`, runs verification, and publishes to npm with the `alpha` dist-tag.

- Manual publish:
  - Open the `release` workflow in GitHub Actions.
  - Run it with `release_tag=v0.1.0-alpha.1`.

## Teammate Install Command

```bash
npm install -g @denguinho/rex@alpha
```

Rex uses `node-llama-cpp` for local embeddings (Metal GPU on Apple Silicon via llama.cpp). The GGUF model (`nomic-ai/nomic-embed-text-v1.5-GGUF` Q8_0, ~140 MB) downloads automatically to node-llama-cpp's cache on first `embed()` call. No manual setup required.
