#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { QCTL_VERSION, type PlatformStage } from "@qctl/shared";

const STAGES: PlatformStage[] = [
  "network-up",
  "host-baseline",
  "tier0-seal",
  "bw-tier0",
  "ssh-host-keys",
  "admin-user",
  "start-services",
  "registry-login",
  "tank-import",
  "zfs-drill",
  "hg-clone",
  "ready-stamp",
];

const main = defineCommand({
  meta: {
    name: "qctl-platform-rocky",
    version: QCTL_VERSION,
    description: "Rocky Linux appliance platform adapter for qctl init",
  },
  subCommands: {
    stage: defineCommand({
      meta: {
        name: "stage",
        description: "Run a single platform init stage",
      },
      args: {
        name: {
          type: "positional",
          required: true,
          description: `Stage name (${STAGES.join(" | ")})`,
        },
      },
      async run({ args }) {
        const name = String(args.name);
        if (!STAGES.includes(name as PlatformStage)) {
          console.error(`unknown stage: ${name}`);
          console.error(`known: ${STAGES.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        console.error(`qctl-platform-rocky stage ${name}: not implemented yet`);
        process.exitCode = 1;
      },
    }),
    list: defineCommand({
      meta: {
        name: "list",
        description: "List platform init stages in order",
      },
      async run() {
        for (const stage of STAGES) {
          console.log(stage);
        }
      },
    }),
  },
});

runMain(main);
