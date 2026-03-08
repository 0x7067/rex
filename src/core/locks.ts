import fs from "node:fs";
import path from "node:path";
import { rexHome } from "./config.js";

type LockPayload = {
  pid: number;
  started_at: string;
  kind: "add";
};

export function acquireResourceAddLock(resourceId: string): boolean {
  const lockPath = resourceAddLockPath(resourceId);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (isLiveLock(lockPath)) {
    return false;
  }

  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
        kind: "add",
      } satisfies LockPayload),
      { encoding: "utf-8", flag: "wx" },
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return isLiveLock(lockPath) ? false : acquireResourceAddLock(resourceId);
    }
    throw error;
  }
}

export function isResourceAddLocked(resourceId: string): boolean {
  return isLiveLock(resourceAddLockPath(resourceId));
}

export function releaseResourceAddLock(resourceId: string): void {
  const lockPath = resourceAddLockPath(resourceId);
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // Best effort cleanup for CLI locks.
  }
}

function resourceAddLockPath(resourceId: string): string {
  return path.join(rexHome(), "locks", "resources", `${resourceId}.add.lock`);
}

function isLiveLock(lockPath: string): boolean {
  if (!fs.existsSync(lockPath)) return false;

  try {
    const payload = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as Partial<LockPayload>;
    if (typeof payload.pid !== "number" || !processExists(payload.pid)) {
      fs.rmSync(lockPath, { force: true });
      return false;
    }
    return true;
  } catch {
    fs.rmSync(lockPath, { force: true });
    return false;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
