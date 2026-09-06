import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("backup and restore scripts", () => {
  let directory: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "kinmu-operations-"));
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const executable = (name: string, body: string) =>
      writeFileSync(join(bin, name), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o700 });
    // Simulate Compose passing the env-file settings into its container only.
    executable(
      "docker",
      `
if [ "$2" = version ]; then exit 0; fi
while [ "$1" != exec ]; do shift; done
shift 3
export POSTGRES_USER='custom user' POSTGRES_DB='custom db'
exec "$@"`,
    );
    executable(
      "pg_dump",
      `
printf '%s\\n' "$@" > "$OPERATIONS_LOG"
printf '%s' "$(umask)" > "$OPERATIONS_MASK"
printf 'database contents'
exit "$OPERATIONS_FAIL"`,
    );
    executable(
      "psql",
      `
printf '%s\\n' "$@" >> "$OPERATIONS_LOG"
printf '%s\\n' "$OPERATIONS_TABLE_COUNT"`,
    );
    executable(
      "pg_restore",
      `
printf '%s\\n' "$@" >> "$OPERATIONS_LOG"
cat > "$OPERATIONS_RESTORED"`,
    );
    const settings = join(directory, "production.env");
    writeFileSync(settings, 'POSTGRES_USER="custom user"\nPOSTGRES_DB="custom db"\n');
    env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      ENV_FILE: settings,
      BACKUP_DIR: join(directory, "backups"),
      OPERATIONS_LOG: join(directory, "calls"),
      OPERATIONS_MASK: join(directory, "mask"),
      OPERATIONS_RESTORED: join(directory, "restored"),
      OPERATIONS_FAIL: "0",
      OPERATIONS_TABLE_COUNT: "0",
    };
    delete env.POSTGRES_USER;
    delete env.POSTGRES_DB;
  });

  afterEach(() => rmSync(directory, { force: true, recursive: true }));

  function run(script: string, args: string[] = []) {
    return spawnSync("sh", [resolve("scripts", script), ...args], { env, encoding: "utf8" });
  }

  it("uses container credentials and keeps backups private from creation, without overwrites", () => {
    const first = run("backup.sh");
    const second = run("backup.sh");
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).not.toBe(second.stdout);
    expect(readFileSync(env.OPERATIONS_LOG!, "utf8")).toBe("-U\ncustom user\n-d\ncustom db\n-Fc\n");
    expect(parseInt(readFileSync(env.OPERATIONS_MASK!, "utf8"), 8)).toBe(0o77);
    expect(statSync(first.stdout.trim()).mode & 0o777).toBe(0o600);
    expect(readFileSync(first.stdout.trim(), "utf8")).toBe("database contents");
    expect(readdirSync(env.BACKUP_DIR!)).toHaveLength(2);
  });

  it("removes an incomplete backup and preserves an earlier successful backup", () => {
    const success = run("backup.sh");
    env.OPERATIONS_FAIL = "1";
    const failure = run("backup.sh");
    expect(failure.status).not.toBe(0);
    expect(failure.stdout).toBe("");
    expect(readdirSync(env.BACKUP_DIR!)).toHaveLength(1);
    expect(readFileSync(success.stdout.trim(), "utf8")).toBe("database contents");
  });

  it("checks and restores the same custom database atomically", () => {
    const backup = run("backup.sh").stdout.trim();
    writeFileSync(env.OPERATIONS_LOG!, "");
    env.CONFIRM_RESTORE = "EMPTY_DATABASE";
    expect(run("restore.sh", [backup]).status).toBe(0);
    const calls = readFileSync(env.OPERATIONS_LOG!, "utf8");
    expect(calls.match(/-U\ncustom user\n-d\ncustom db\n/g)).toHaveLength(2);
    expect(calls).toContain("--exit-on-error\n--single-transaction");
    expect(readFileSync(env.OPERATIONS_RESTORED!, "utf8")).toBe("database contents");
  });

  it("refuses a nonempty target and requires the restore confirmation", () => {
    const backup = run("backup.sh").stdout.trim();
    expect(run("restore.sh", [backup]).status).toBe(2);
    env.CONFIRM_RESTORE = "EMPTY_DATABASE";
    env.OPERATIONS_TABLE_COUNT = "1";
    const restored = run("restore.sh", [backup]);
    expect(restored.status).toBe(1);
    expect(restored.stderr).toContain("not empty");
    expect(readdirSync(directory)).not.toContain("restored");
  });
});
