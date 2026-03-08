import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSync } from "../../src/cli/sync.js";

const mockGetProvider = vi.fn();
const mockListResources = vi.fn();
const mockGetResourceByName = vi.fn();
const mockSyncResource = vi.fn();
const mockIsResourceAddLocked = vi.fn();

vi.mock("../../src/core/registry.js", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  listResources: (...args: unknown[]) => mockListResources(...args),
  getResourceByName: (...args: unknown[]) => mockGetResourceByName(...args),
}));

vi.mock("../../src/core/sync.js", () => ({
  syncResource: (...args: unknown[]) => mockSyncResource(...args),
}));

vi.mock("../../src/core/locks.js", () => ({
  isResourceAddLocked: (...args: unknown[]) => mockIsResourceAddLocked(...args),
}));

describe("registerSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProvider.mockReturnValue({ name: "ollama", model: null, endpoint: null });
    mockSyncResource.mockResolvedValue({
      name: "ready",
      filesChanged: 0,
      chunksUpdated: 0,
      status: "ok",
    });
  });

  it("skips locked resources instead of syncing them", async () => {
    const locked = {
      id: "locked-1",
      name: "locked",
      last_sync_status: "ok",
    };
    const ready = {
      id: "ready-1",
      name: "ready",
      last_sync_status: "ok",
    };
    mockListResources.mockReturnValue([locked, ready]);
    mockIsResourceAddLocked.mockImplementation((id: string) => id === "locked-1");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const program = new Command();
    program.option("--json");
    registerSync(program);

    await program.parseAsync(["--json", "sync"], { from: "user" });

    expect(mockSyncResource).toHaveBeenCalledTimes(1);
    expect(mockSyncResource).toHaveBeenCalledWith(
      ready,
      { name: "ollama", model: null, endpoint: null },
      false,
      expect.any(Function),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'Skipping "locked": add is still running.',
    );
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify([{
        name: "ready",
        filesChanged: 0,
        chunksUpdated: 0,
        status: "ok",
      }], null, 2),
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
