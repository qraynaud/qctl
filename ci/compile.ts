#!/usr/bin/env bun
/**
 * Compile qctl binaries with `bun build --compile`.
 *
 * Usage:
 *   bun run ci/compile.ts              # all targets
 *   bun run ci/compile.ts host
 *   bun run ci/compile.ts guest
 *   bun run ci/compile.ts platform-rocky
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "dist");

type Target = {
  id: string;
  entry: string;
  outfile: string;
};

const TARGETS: Target[] = [
  {
    id: "host",
    entry: "packages/host/src/cli.ts",
    outfile: "qctl-host",
  },
  {
    id: "guest",
    entry: "packages/guest/src/cli.ts",
    outfile: "qctl",
  },
  {
    id: "platform-rocky",
    entry: "packages/platform-rocky/src/cli.ts",
    outfile: "qctl-platform-rocky",
  },
];

async function compileOne(target: Target) {
  const outPath = join(OUT, target.outfile);
  console.log(`compile ${target.id} → ${outPath}`);
  const proc = Bun.spawn(
    ["bun", "build", "--compile", join(ROOT, target.entry), `--outfile=${outPath}`],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`compile failed for ${target.id} (exit ${code})`);
  }
}

async function main() {
  const only = process.argv[2];
  const selected = only ? TARGETS.filter((t) => t.id === only) : TARGETS;
  if (selected.length === 0) {
    console.error(`unknown target: ${only}`);
    console.error(`known: ${TARGETS.map((t) => t.id).join(", ")}`);
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  for (const target of selected) {
    await compileOne(target);
  }
  console.log("done");
}

await main();
