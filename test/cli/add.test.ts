import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdd } from "../../src/cli/add.js";

const {
  mockOraStart,
  mockSpinner,
  mockLocalAdapter,
  mockGitAdapter,
  mockPackageAdapter,
  mockIndexResourceFiles,
  mockGenerateSummaries,
  mockAcquireResourceAddLock,
  mockReleaseResourceAddLock,
  mockAddResource,
  mockGetProvider,
  mockUpdateResource,
  mockCreateResource,
  mockSnapshotsDir,
} = vi.hoisted(() => {
  const mockOraStart = vi.fn();
  const mockSpinner = {
    start: mockOraStart,
    fail: vi.fn(),
    succeed: vi.fn(),
    stop: vi.fn(),
    text: "",
  };

  const mockLocalAdapter = {
    type: "local",
    detect: vi.fn(),
    normalize: vi.fn(),
    materialize: vi.fn(),
  };

  const mockGitAdapter = {
    type: "git",
    detect: vi.fn(),
  };

  const mockPackageAdapter = {
    type: "package",
    detect: vi.fn(),
  };

  return {
    mockOraStart,
    mockSpinner,
    mockLocalAdapter,
    mockGitAdapter,
    mockPackageAdapter,
    mockIndexResourceFiles: vi.fn(),
    mockGenerateSummaries: vi.fn(),
    mockAcquireResourceAddLock: vi.fn(),
    mockReleaseResourceAddLock: vi.fn(),
    mockAddResource: vi.fn(),
    mockGetProvider: vi.fn(),
    mockUpdateResource: vi.fn(),
    mockCreateResource: vi.fn(),
    mockSnapshotsDir: vi.fn(),
  };
});

vi.mock("ora", () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock("../../src/adapters/local.js", () => ({
  localAdapter: mockLocalAdapter,
}));

vi.mock("../../src/adapters/git.js", () => ({
  gitAdapter: mockGitAdapter,
}));

vi.mock("../../src/adapters/package.js", () => ({
  packageAdapter: mockPackageAdapter,
}));

vi.mock("../../src/indexing/pipeline.js", () => ({
  indexResourceFiles: (...args: unknown[]) => mockIndexResourceFiles(...args),
}));

vi.mock("../../src/query/answerer.js", () => ({
  generateSummaries: (...args: unknown[]) => mockGenerateSummaries(...args),
}));

vi.mock("../../src/core/locks.js", () => ({
  acquireResourceAddLock: (...args: unknown[]) => mockAcquireResourceAddLock(...args),
  releaseResourceAddLock: (...args: unknown[]) => mockReleaseResourceAddLock(...args),
}));

vi.mock("../../src/core/registry.js", () => ({
  addResource: (...args: unknown[]) => mockAddResource(...args),
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  updateResource: (...args: unknown[]) => mockUpdateResource(...args),
}));

vi.mock("../../src/core/resource.js", () => ({
  createResource: (...args: unknown[]) => mockCreateResource(...args),
}));

vi.mock("../../src/core/config.js", () => ({
  snapshotsDir: (...args: unknown[]) => mockSnapshotsDir(...args),
}));

describe("registerAdd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOraStart.mockReturnValue(mockSpinner);
    mockLocalAdapter.detect.mockReturnValue(true);
    mockLocalAdapter.normalize.mockResolvedValue("/tmp/some-project");
    mockLocalAdapter.materialize.mockResolvedValue({
      type: "local",
      absolute_path: "/tmp/some-project",
    });
    mockSnapshotsDir.mockReturnValue("/tmp/rex-snapshots");
    mockCreateResource.mockReturnValue({
      id: "resource-1",
      name: "some-project",
      type: "local",
      source: "./some-project",
      normalized_source: "/tmp/some-project",
      notes: "",
      include_rules: [],
      exclude_rules: [],
      snapshot_metadata: {
        type: "local",
        absolute_path: "/tmp/some-project",
      },
    });
    mockAcquireResourceAddLock.mockReturnValue(true);
    mockGetProvider.mockReturnValue(null);
  });

  it("explains that the resource was saved but not indexed when no provider is configured", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerAdd(program);

    await program.parseAsync(["add", "./some-project"], { from: "user" });

    expect(mockAddResource).toHaveBeenCalled();
    expect(mockIndexResourceFiles).not.toHaveBeenCalled();
    expect(mockSpinner.fail).toHaveBeenCalledWith(
      'No provider configured. Saved "some-project", but skipped indexing.',
    );

    errSpy.mockRestore();
  });
});
