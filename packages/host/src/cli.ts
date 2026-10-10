#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { QCTL_VERSION } from "@qctl/shared";

const main = defineCommand({
  meta: {
    name: "qctl",
    version: QCTL_VERSION,
    description: "qctl host CLI — scaffold instances and manage appliance VMs",
  },
  subCommands: {
    init: defineCommand({
      meta: {
        name: "init",
        description: "Scaffold a new instance repo (mise.toml, schemas, provision/)",
      },
      args: {
        dir: {
          type: "positional",
          description: "Target directory (default: .)",
          required: false,
          default: ".",
        },
      },
      async run({ args }) {
        console.error(`qctl init: not implemented yet (dir=${args.dir})`);
        process.exitCode = 1;
      },
    }),
    new: defineCommand({
      meta: {
        name: "new",
        description: "Scaffold app / common / network trees",
      },
      subCommands: {
        app: defineCommand({
          meta: { name: "app", description: "Create applications/<name>/" },
          args: {
            name: { type: "positional", required: true, description: "App name" },
          },
          async run({ args }) {
            console.error(`qctl new app: not implemented yet (name=${args.name})`);
            process.exitCode = 1;
          },
        }),
        common: defineCommand({
          meta: { name: "common", description: "Create common/<name>/" },
          args: {
            name: { type: "positional", required: true, description: "Common package name" },
          },
          async run({ args }) {
            console.error(`qctl new common: not implemented yet (name=${args.name})`);
            process.exitCode = 1;
          },
        }),
        network: defineCommand({
          meta: { name: "network", description: "Create networks/<name>/" },
          args: {
            name: { type: "positional", required: true, description: "Network name" },
          },
          async run({ args }) {
            console.error(`qctl new network: not implemented yet (name=${args.name})`);
            process.exitCode = 1;
          },
        }),
      },
    }),
    vm: defineCommand({
      meta: {
        name: "vm",
        description: "Appliance VM lifecycle (seed embeds guest tooling)",
      },
      subCommands: {
        seed: stubVm("seed"),
        download: stubVm("download"),
        up: stubVm("up"),
        down: stubVm("down"),
        destroy: stubVm("destroy"),
        "init-tank": stubVm("init-tank"),
        status: stubVm("status"),
        "ssh-info": stubVm("ssh-info"),
        "target-check": stubVm("target-check"),
      },
    }),
  },
});

function stubVm(name: string) {
  return defineCommand({
    meta: { name, description: `VM ${name} (not implemented yet)` },
    async run() {
      console.error(`qctl vm ${name}: not implemented yet`);
      process.exitCode = 1;
    },
  });
}

runMain(main);
