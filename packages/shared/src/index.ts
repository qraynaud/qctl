/** Shared types and helpers for host, guest, and platform packages. */

export const QCTL_VERSION = "0.0.0";

export type QctlRole = "host" | "guest" | "platform";

export type PlatformStage =
  | "network-up"
  | "host-baseline"
  | "tier0-seal"
  | "bw-tier0"
  | "ssh-host-keys"
  | "admin-user"
  | "start-services"
  | "registry-login"
  | "tank-import"
  | "zfs-drill"
  | "hg-clone"
  | "ready-stamp";

/** Contract between guest `qctl init` and `qctl-platform-*`. */
export interface PlatformAdapter {
  readonly name: string;
  runStage(stage: PlatformStage, ctx: PlatformStageContext): Promise<void>;
}

export interface PlatformStageContext {
  profile: "default" | "init-tank";
  dryRun?: boolean;
}

export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `unexpected value: ${String(value)}`);
}
