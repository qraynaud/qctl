/**
 * Public thin VM backend contract (types only).
 *
 * Shared brand helper: `./drivers/id.js` (`vmDriverIdSchema`).
 * Each driver module exports its own `id = vmDriverIdSchema.parse('…')`.
 * Orchestration lives in shared runners; backends expose hypervisor primitives.
 */
import type { z } from 'zod'

import type { ProvisionBody } from '../provision/schema/parse.js'
import type { SyncEndpoint } from '../sync/endpoint.js'
import type { vmDriverIdSchema } from './drivers/id.js'
import type { SerialFollow } from './libs/console.js'
import type { VmFlagStore } from './libs/flag-store.js'

export type VmDriverId = z.output<typeof vmDriverIdSchema>

export type { SerialFollow, SyncEndpoint, VmFlagStore }

/** Provision / QCTL_ENV name (open; declared in `qctl.environments`). */
export type VmEnv = string

/** Seed template kind — host `runSeed` only; never passed to the module. */
export type VmSeedProfile = 'appliance' | 'init-tank'

/**
 * Resolved VM run context (built from CLI argv at the edge).
 * Driver identity is **not** here — callers hold {@link VmDriverModule} from the
 * registry (`resolveDriver` → `{ module, ctx }`); use `module.id` for provision
 * overlay keys / seed target.
 */
export type VmContext = {
  env: VmEnv
  profile?: string
  production?: boolean
  name: string
  dryRun: boolean
  timeout: number
  signal?: AbortSignal
  /** Libvirt URI — ignored by backends that do not need it. */
  connect?: string
}

/** Wait / UX only — no product mode flags (lifecycle / wipeOs / download / seed). */
export type VmUpOptions = {
  /** Stream guest serial and wait on classifiers (default false = fire-and-forget start). */
  console?: boolean
  timeout?: number
}

/** Host-only init-tank runner opts (pool selection + tank recreate). */
export type VmInitTankOptions = VmUpOptions & {
  poolIds?: string[]
  force?: boolean
}

export type VmDownOptions = {
  force?: boolean
  timeout?: number
}

export type VmDestroyOptions = {
  /**
   * Disk labels to retain after the guest is removed.
   * Omit or `[]` → wipe all managed disks. Host maps product policy
   * (e.g. former `--keep-persistent`) to concrete labels.
   */
  keepDisks?: string[]
  yes?: boolean
}

export type ResolveEndpointOptions = {
  user?: string
  host?: string
  port?: number
  remoteDir?: string
  identity?: string
  network?: string
}

export type DefaultVmNameOpts = {
  env?: VmEnv | string
  production?: boolean
  environments?: Record<string, { production?: boolean }>
}

export type VmPowerKind = 'running' | 'stopped' | 'absent'
export type VmPowerState = {
  kind: VmPowerKind
  /** Raw hypervisor state (e.g. libvirt "paused"). */
  detail?: string
}

/** Local disk image format (host always sets; drivers may ignore). */
export type VmDiskFormat = 'qcow2' | 'raw'

type VmDiskBase = {
  /** Local path (qcow / by-id) — always set by host prep. */
  path: string
  format: VmDiskFormat
}

/**
 * One block device for the hypervisor — no product role (os/tank/data).
 * Keyed by label on {@link VmDisksSpec} (duplicates unrepresentable).
 * Matches provision attach-mode: {@link size} present → virtual; omit → physical.
 */
export type VmDiskSpec = VmDiskBase &
  (
    | {
        type: 'virtual'
        size: string
        /** Base to clone/import from (local qcow or storage volid). */
        image?: string
      }
    | { type: 'physical' }
  )

/**
 * Desired disks keyed by stable serial / label.
 * Insertion order is attach order.
 */
export type VmDisksSpec = Record<string, VmDiskSpec>

/**
 * One host NIC — provision `networking.interfaces.<label>.vm` (+ guest iface).
 * Keyed by provision **label** on {@link VmNicsSpec}; drivers sort labels for order.
 * Every entry with `vm` in provision becomes one hypervisor NIC (explicit mode).
 */
export type VmNicSpec = {
  /** Guest netdev name (seed / guest apply). */
  iface: string
  mac?: string
} & (
  | {
      mode: 'bridge'
      bridge: string
      vlan?: { mode: 'access' | 'trunk'; ids: number[] }
    }
  | { mode: 'nat' }
)

/** Bridged NIC plan entry (`mode: 'bridge'`). */
export type VmNicBridgeSpec = Extract<VmNicSpec, { mode: 'bridge' }>

/**
 * Desired hypervisor NICs keyed by provision label (sorted for attach order).
 * Omit on {@link VmSpecs} → driver leaves NICs alone (patch semantics).
 */
export type VmNicsSpec = Record<string, VmNicSpec>

/**
 * Full desired guest shape for {@link VmDriverModule.create}.
 * {@link VmDriverModule.reconcile} takes {@link Partial}<{@link VmSpecs}>
 * (patch: only listed fields change; nothing read from {@link VmContext}).
 */
export type VmSpecs = {
  memory: number
  vcpus: number
  disks: VmDisksSpec
  /** Host-built seed ISO path (drivers never see seed profile). */
  seedIsoPath: string
  /**
   * Hypervisor NICs from `ethernet.vm` (one per label with `vm`).
   * Same plan shape for create + reconcile — driver applies remove/update/create.
   */
  nics?: VmNicsSpec
  osinfo?: string
  /** Label of the disk to boot from (must be a key of {@link disks}). */
  bootDrive?: string
}

/**
 * Facts for shared check report assembly (refined when the check runner lands).
 */
export type VmCheckFact = {
  id: string
  ok: boolean
  detail?: string
}

export type VmCheckFacts = {
  items: VmCheckFact[]
}

/** Extra status fields beyond {@link VmPowerState} (vmid, memory, …). */
export type VmStatusExtras = Record<string, string | number | boolean | null | undefined>

/** Disk path row when the guest is absent (status fallback). */
export type VmStatusDiskHint = {
  id: string
  path: string
  exists: boolean
}

/**
 * Data for `vm status` / `vm ssh-info` — drivers gather; CLI/runners print.
 */
export type VmStatusSnapshot = {
  power: VmPowerState
  /** Primary dump (e.g. virsh dominfo text) or one-line headline. */
  summary?: string
  /** Structured rows (status, uptime, cpus, …). */
  fields?: VmStatusExtras
  /** Local disk paths when the guest is not defined. */
  disks?: VmStatusDiskHint[]
  /** Shell / console hint block (title + plain lines; styling is CLI-side). */
  hints?: { title?: string; lines: string[] }
}

/**
 * Registered driver: identity + provision overlay + thin hypervisor ops.
 *
 * `THandle` is the driver’s opaque VM identity (libvirt session, PVE vmid wrap, …).
 * Runners stay generic over it; they never inspect handle fields.
 *
 * Product policy (seed kind, waits, INSTALLED, ephemeral teardown, wipe-os,
 * image download) belongs in shared runners / commands — not here.
 */
export type VmDriverModule<THandle = unknown> = {
  id: VmDriverId
  defaultVmName: (opts: DefaultVmNameOpts) => string
  provisionOverlaySchema: z.ZodType
  /** Cross-field checks for this driver's overlay (Zod superRefine). */
  refineProvision?: (data: ProvisionBody, ctx: z.RefinementCtx) => void
  /** Short hint for `qctl init` / `qctl new profile` target pickers. */
  scaffoldHint?: string
  /**
   * Stub body for `provision/target-<id>.yaml` when no Nunjucks scaffold
   * template exists under `templates/provision/`.
   */
  scaffoldTargetYaml?: () => string

  createFlagStore: (ctx: VmContext) => Promise<VmFlagStore>
  powerState: (ctx: VmContext) => Promise<VmPowerState>
  resolveEndpoint: (ctx: VmContext, opts?: ResolveEndpointOptions) => Promise<SyncEndpoint>
  collectCheckFacts: (ctx: VmContext) => Promise<VmCheckFacts>
  ensureHostReady?: (ctx: VmContext) => Promise<void>
  /**
   * Full host preflight for `vm target-check` (bins, API, provision).
   * Shared runner wraps this; prefer expanding {@link collectCheckFacts} over time.
   */
  targetCheck?: (ctx: VmContext) => Promise<boolean>
  /** Snapshot for status / ssh-info — no console I/O. */
  getStatus: (ctx: VmContext) => Promise<VmStatusSnapshot>

  find: (ctx: VmContext) => Promise<THandle | null>
  /** Patch guest — only fields present on `specs` change. Omit → no-op. */
  reconcile: (ctx: VmContext, vm: THandle, specs?: Partial<VmSpecs>) => Promise<void>

  /** Define / register only — full {@link VmSpecs}; guest not running. */
  create: (ctx: VmContext, specs: VmSpecs, signal: AbortSignal) => Promise<THandle>

  /**
   * Power on. `serial: true` attaches/follows guest serial; omit/false clears
   * first-boot serial wiring if present. Does not wait for guest completion.
   * `classify` is applied to serial lines when following (runner-chosen).
   */
  start: (
    ctx: VmContext,
    vm: THandle,
    opts?: {
      serial?: boolean
      classify?: (line: string) => { status: 'ok' | 'fail'; line: string } | null
    },
  ) => Promise<SerialFollow | null>

  stop: (ctx: VmContext, vm: THandle, opts?: { force?: boolean }) => Promise<void>
  /**
   * Undefine/delete guest (via internal {@link find}) + wipe disks not listed in
   * {@link VmDestroyOptions.keepDisks}.
   */
  destroy: (ctx: VmContext, opts?: VmDestroyOptions) => Promise<void>

  detachSeed: (ctx: VmContext, vm: THandle) => Promise<void>
}

/**
 * Registry entry while thin ops are still being filled in (handle-erased).
 * Requires {@link VmDriverModule.id}; other fields optional until later phases.
 */
export type VmDriverRegistration = Pick<VmDriverModule, 'id'> & Partial<Omit<VmDriverModule, 'id'>>
