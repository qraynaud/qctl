#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { QCTL_VERSION } from "@qctl/shared";

const main = defineCommand({
  meta: {
    name: "qctl",
    version: QCTL_VERSION,
    description: "qctl guest CLI — appliance init, quadlets, and secrets",
  },
  subCommands: {
    init: defineCommand({
      meta: {
        name: "init",
        description: "First-boot / appliance init (systemd); runs platform stages",
      },
      args: {
        profile: {
          type: "string",
          description: "Init profile: default | init-tank",
          default: "default",
        },
      },
      async run({ args }) {
        console.error(`qctl init: not implemented yet (profile=${args.profile})`);
        process.exitCode = 1;
      },
    }),
    quadlet: defineCommand({
      meta: {
        name: "quadlet",
        description: "Generate and manage Quadlet units from instance schemas",
      },
      subCommands: {
        up: stubQuadlet("up"),
        down: stubQuadlet("down"),
        enable: stubQuadlet("enable"),
        start: stubQuadlet("start"),
        stop: stubQuadlet("stop"),
        restart: stubQuadlet("restart"),
        ps: stubQuadlet("ps"),
      },
    }),
    secret: defineCommand({
      meta: {
        name: "secret",
        description: "Sync @sensitive schema values to Podman secrets",
      },
      subCommands: {
        sync: defineCommand({
          meta: {
            name: "sync",
            description: "Resolve @sensitive via varlock → podman secret create/update",
          },
          async run() {
            console.error("qctl secret sync: not implemented yet");
            process.exitCode = 1;
          },
        }),
        backend: defineCommand({
          meta: {
            name: "backend",
            description: "Switch resolver/plugin in schemas after presence check",
          },
          args: {
            name: {
              type: "positional",
              required: true,
              description: "Backend name (e.g. vaultwarden, fake, op)",
            },
          },
          async run({ args }) {
            console.error(`qctl secret backend: not implemented yet (name=${args.name})`);
            process.exitCode = 1;
          },
        }),
      },
    }),
  },
});

function stubQuadlet(name: string) {
  return defineCommand({
    meta: { name, description: `Quadlet ${name} (not implemented yet)` },
    async run() {
      console.error(`qctl quadlet ${name}: not implemented yet`);
      process.exitCode = 1;
    },
  });
}

runMain(main);
