# Disaster recovery

Rebuild the **OS** from the same Rocky 9 cloud image + cloud-init recipe. Prefer
reattaching surviving **`/vw`** and **`tank`** disks so Path A can unlock without a
Vaultwarden server.

Related: [README.md](README.md) (index), [`cloud-init/README.md`](cloud-init/README.md),
[`VALIDATE.md`](VALIDATE.md), [`README.md`](README.md),
[`@qctl/platform-rocky`](../../qctl/packages/platform-rocky/README.md).

## Rebuild from cloud image + seed

### Workstation (libvirt)

```bash
qctl vm seed                 # Tier-0 from provision/.env.*; topology + SSH from provision/*.yaml
qctl vm destroy --keep-data  # drop OS only; keep /vw + tank vdevs
qctl vm up --wipe-os         # fresh OS overlay + same seed → first-boot Path A
```

If tank disks were never initialized: `qctl vm init-tank` once, then
`up --wipe-os`. Do **not** recreate the pool on a normal OS rebuild.

### Proxmox

1. Keep `/vw` + data/special disks attached (or reattach by serial/by-id).
2. Replace or reinstall the OS disk from the **pinned** GenericCloud qcow2
   ([`cloud-init/README.md`](cloud-init/README.md)).
3. Attach the same rendered cloud-init (snippets / cloud-init drive) with Tier-0 +
   admin SSH — same substitution `vm seed` performs locally.
4. Boot; first-boot mounts `/vw`, unlocks `bw`, re-seeds the tank key file if needed,
   imports `tank`.

## ZFS pool key (Vaultwarden)

| Layer | Location |
|-------|----------|
| **SoT** | VW Login **`rocky`** custom field **`tank-passphrase`** |
| **On disk** | `/etc/credstore/rocky/tank_passphrase` (plaintext by design; crypto-shred + VW re-seed) |
| **ZFS** | `keylocation=file:///etc/credstore/rocky/tank_passphrase` |
| **Reboot** | `zfs-mount-generator` + `/etc/zfs/zfs-list.cache/tank` → `zfs-load-key@tank` |

First-boot `tank-import` / `tank-create` resolve bootstrap `TANK_PASSPHRASE` (prod: `vw()`
after `@initVw` unlocks `/vw`) and reseed the on-disk file when missing. Prefer **not**
baking the passphrase into the seed ISO.

Never put Vaultwarden CLI apodata (`@initVw(appDataDir=…)`) on encrypted `tank`.
On-box VW **container** data belongs on `/tank`.

## Preferred — Path A (automated)

`/vw` survived with a previously synced Bitwarden CLI vault:

1. New OS + seed with Tier-0 systemd creds (`@tag(guest)` on `provision/.env.*`).
2. First-boot mounts `/vw` → `@initVw` offline unlock → re-seed tank key from bootstrap
   if needed → import/mount `tank` (stock ZFS units).
3. Start Quadlets (on-box VW data already on `/tank`). No hand-paste of the pool key; VW
   server need not be up.

## Path B — `/vw` empty or lost

1. Restore a reachable Vaultwarden (e.g. restic → temp host; point DNS), **or** use
   personal/prod VW (`serverUrl` on `@initVw` in `bootstrap/.env.prod`).
2. Rebuild Rocky; `@initVw` apikey login+sync into `/vw` (first graph resolve that needs VW).
3. `tank-import` writes key file from `TANK_PASSPHRASE` → unlock `tank` → Quadlets.
   If private images: ensure `@tag(container-registry)` bindings apply (`registry-login`).

## Fallback

Workstation that previously synced VW: copy Tier-0 into seed creds (or a small recovery
script that injects them). Avoid pasting the pool passphrase by hand if the bootstrap
graph can still resolve `TANK_PASSPHRASE`.

## Worst

Re-seed Tier-0 from memory/backup codes, restore VW from restic, Path B, then sync.

## Prod cutover sketch

Stop apps on the old host → `zpool export tank` → move/passthrough disks to Rocky →
boot with `/vw` (Path A) or Path B → import + unlock → enable Quadlets. Lab Gate 5
(`35` export→import drill) rehearses the cold handoff; see [`VALIDATE.md`](VALIDATE.md).
