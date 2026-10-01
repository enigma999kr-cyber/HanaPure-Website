import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modules = ["lib/auth/admin-auth.ts", "lib/auth/admin-authorization.ts", "lib/auth/trusted-admin-actor.ts",
  "lib/auth/authorized-emergency-override.ts", "lib/supabase/server.ts", "lib/erp/postgres-emergency-override-store.ts"];

test("all privileged modules reject imports without react-server conditions", async () => {
  for (const path of modules) {
    const source = await readFile(path, "utf8");
    assert.match(source, /^import "server-only";/);
    assert.doesNotMatch(source, /NEXT_PUBLIC_|sb_secret_|service_role_key|use client|use server/);
    const result = spawnSync(process.execPath, ["--import", "./tests/server-only-loader.mjs", "--input-type=module",
      "--eval", `await import('./${path}')`], { encoding: "utf8", windowsHide: true });
    assert.notEqual(result.status, 0, path);
    assert.match(result.stderr, /cannot be imported from a Client Component/, path);
  }
});
