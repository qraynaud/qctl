# Validation checklist (Rocky auto-install)

Use this after changing cloud-init, `qctl init` stages, or ZFS helpers. Lab default:
workstation libvirt via `qctl vm`. Same gates apply on Proxmox
(Gate 8).

Related: [README.md](README.md) (index), [cloud-init/README.md](cloud-init/README.md),
[local/README.md](local/README.md), [DR.md](DR.md),
[`@qctl/platform-rocky`](../../qctl/packages/platform-rocky/README.md).

## Prod cutover mapping


| Lab gate / action                                                                    | Prod analogue                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `init-tank` (`tank-create` stage) on empty vdevs                                        | Build encrypted `tank` on TrueNAS (or dedicated init), then export                    |
| Keep `/vw` + data/special across OS wipe                                             | Reattach surviving `/vw` + tank disks to new Rocky VM                                 |
| First-boot VW Path A                                                                       | Offline unlock from `/vw` during bootstrap graph resolve                             |
| First-boot VW Path B                                                                       | Empty `/vw`: apikey login + sync to reachable VW during graph resolve                |
| First-boot `tank-import` stage                                                          | Reseed key from `TANK_PASSPHRASE`; `zpool import` + `keylocation=file://…`          |
| First-boot `35` export→import drill                                                  | Cold handoff rehearsal: export on old host → import+unlock on Rocky                   |
| Gate 6 reboot                                                                        | Official `zfs-mount-generator` + `/etc/zfs/zfs-list.cache/tank` → `zfs-load-key@tank` |
| VW Login `rocky` (admin + `tank-passphrase`; `container-registry-N`; attachments `ssh-host-keys.tar.gz` / `heptapod-deploy-key`) | Same SoT Login in prod VW |
| Masked `sshd` until the `start-services` stage (admin+keys in `admin-user`)                             | Stable host keys from VW before SSH accepts connections                               |


Do **not** put Vaultwarden CLI apodata (`@initVw(appDataDir=…)`) on encrypted `tank`.
On-box VW **container** data belongs on `/tank`.

---



## Gate 0 — Seed builds

- [ ] `qctl vm seed` writes `~/.cache/qctl/repos/<hash>/seed/<env>/nocloud.iso` + `instance-id`
- [ ] Seed embeds guest `qctl-guest` + `qctl-platform-rocky.mjs` (`qctl-guest/` on the ISO); Tier-0 pending paths present when provision guest tags exist (or intentionally omitted with `--allow-missing-tier0` for dry docs only)
- [ ] `user-data` is valid YAML after tag resolution (use `qctl vm seed --out /tmp/cidata` to inspect; no leftover `!template` / `!file`)

```bash
qctl vm seed
# optional inspect:
# qctl vm seed --out /tmp/cidata && cloud-init schema --config-file /tmp/cidata/user-data
```

---



## Gate 1 — Boot (workstation)

- [ ] VM gets connectivity (`--network user` → `ssh -p 2222 <admin>@127.0.0.1`, or lease on `default`)
- [ ] SSH as `rocky` (default if Login incomplete) or VW Login `rocky` username with injected admin key (`root` denied; `apps` has no SSH)
- [ ] Cockpit admin: VW Login user (password sudo); or key-only `rocky` + NOPASSWD (no Cockpit password); `https://<guest>:9090`
- [ ] `cloud-init status --wait` → done; no fatal errors in `/var/log/cloud-init.log`
- [ ] `systemctl is-active rocky-first-boot.service` → `active` (or succeeded oneshot)
- [ ] Stamp present: `test -f /var/lib/rocky/first-boot.done`
- [ ] cloud-init waited on qctl init: `cloud-init status` is `done` only with the stamp (error if `rocky-first-boot` failed)
- [ ] SSH host keys match VW Login `rocky` attachment `ssh-host-keys.tar.gz` across OS reinstall (optional Path A check)

```bash
qctl vm up --wipe-os   # keep /vw + tank if already initialized
ssh -p 2222 rocky@127.0.0.1   # or VW Login rocky username
cloud-init status --wait
systemctl status rocky-first-boot.service
journalctl -u rocky-first-boot.service -b --no-pager
test -f /var/lib/rocky/first-boot.done && echo stamp_ok
```

---



## Gate 2 — Baseline software

- [ ] `loginctl show-user apps -p Linger` → `yes`
- [ ] `id -nG apps` includes `systemd-journal` (podman logs / Cockpit journal)
- [ ] `runuser -u apps -- systemctl --user is-active podman.socket` → `active` (API sock for podman-proxy-rootless)
- [ ] `systemctl is-active podman.socket` → `active` (API sock for podman-proxy-rootful)
- [ ] firewalld forward-ports baked into `/usr/local/lib/rocky/dnat-apply.sh` (run by `start-services`) (`port`→`127.0.0.1:dnat`) + `route_localnet=1`
- [ ] Optional: bootstrap `@tag(container-registry)` applied (`registry-login` stage; auth for root + apps)
- [ ] `/etc/subuid` + `/etc/subgid` have `apps:…` only (admin SSH user has none — Podman is apps-only)
- [ ] `runuser -u apps -- podman info` succeeds (no subuid ERRO)
- [ ] `firewalld` and `cockpit.socket` active (Cockpit browser optional)
- [ ] `cockpit-zfs` installed when 45Drives repo + ZoL ABI allow (`rpm -q cockpit-zfs`)
- [ ] `sshd` listening (started in the `start-services` stage, not during package install)
- [ ] `/usr/local/bin/bw --version` present when bootstrap uses Vaultwarden plugin
- [ ] After Gate 7: `/usr/local/bin/quadlet` is installed by `install-qctl-guest` (guest `qctl quadlet` wrapper, not a symlink into `scripts/`); bash-completion installed under `/usr/share/bash-completion/completions/quadlet`
- [ ] `hg --version` (pipx) works
- [ ] `zfs version` / `modprobe zfs` OK

```bash
loginctl show-user apps -p Linger
runuser -u apps -- podman info >/dev/null && echo podman_ok
systemctl is-active firewalld cockpit.socket sshd
bw --version; command -v quadlet; hg --version -q
zfs version | head -3
```

---



## Gate 3 — Secrets bootstrap (`/vw`)

- [ ] `/vw` mounted (serial/label `rocky-vw`); `findmnt /vw`
- [ ] Bootstrap `@initVw(appDataDir=/vw, …)` unlocks via Tier-0 credentials (plugin sets CLI apodata for spawned `bw`)
- [ ] Tier-0 via sealed credstore + `LoadCredentialEncrypted` on `rocky-first-boot` (no TTY master-password prompt)
- [ ] **Path B** (empty `/vw`): login+sync to reachable VW succeeds once
- [ ] **Path A** (kept `/vw` after OS wipe): offline unlock works with VW unreachable
- [ ] Missing Tier-0 → clear failure (do not use `--allow-missing-tier0` for real boots)
- [ ] Bootstrap graph resolves (prod `@initVw` unlock via Tier-0 credentials)

```bash
findmnt /vw
# Path A drill: wipe OS only, leave /vw, re-seed Tier-0, boot offline or with VW down
# qctl vm destroy --keep-data && qctl vm up --wipe-os
```

---



## Gate 4 — Tank present

Pool must already exist (`qctl vm init-tank` or dedicated
`qctl init --profile init-tank`). Appliance first-boot **never** creates the pool.

- [ ] `zpool list` shows `tank`; health ONLINE
- [ ] Encryption on; `zfs get encryption,keystatus,keylocation tank`
- [ ] `keylocation` is `file:///etc/credstore/rocky/tank_passphrase`
- [ ] Datasets mounted under `/tank`; canary `/tank/.rocky-canary` readable
- [ ] `/tank/rocky` clone path exists after Gate 7 (may be empty until then)

```bash
zpool status tank | head -30
zfs get -H encryption,keystatus,keylocation tank
findmnt /tank
cat /tank/.rocky-canary
```

---



## Gate 5 — ZFS export → import → unlock (required)

- [ ] `zfs-drill` stage (`qctl stage zfs-drill`) completed successfully
- [ ] After drill: pool online, key loaded, canary intact
- [ ] Skip only for debug: `ROCKY_SKIP_ZFS_DRILL=1`
- [ ] Mental map to prod: export on old host → attach disks → Rocky import+unlock

```bash
journalctl -u rocky-first-boot.service -b --no-pager | grep -E 'drill|== zfs-drill'
# Manual re-run (pool must be imported):
# qctl stage zfs-drill
```

---



## Gate 6 — Reboot unlock

- [ ] Reboot VM; `tank` imported + unlocked **without** interactive passphrase
- [ ] Official path: `/etc/zfs/zfs-list.cache/tank` present; `zfs-load-key@tank.service` generated (vendor `zfs-load-key.service` stays a `/dev/null` stub)
- [ ] `/tank/.rocky-canary` still present
- [ ] `/vw` still mounted; bootstrap / `qctl secret sync` can resolve VW secrets again if needed

```bash
reboot
# after SSH returns:
test -s /etc/zfs/zfs-list.cache/tank && systemctl cat zfs-load-key@tank.service | head -15
zfs get -H keystatus tank   # available
findmnt /tank && cat /tank/.rocky-canary
```

---



## Gate 7 — Repo + repeatability

- [ ] `/tank/rocky` is an hg repo owned by the admin SSH user; guest `QCTL_ENV` matches seed `--env` (`/etc/environment.d/91-rocky-env.conf`)
- [ ] Deploy key from VW Login `rocky` attachment `heptapod-deploy-key` is in admin `~/.ssh/heptapod_deploy_key` (not seed ISO / not only under `/root`)
- [ ] Existing clone: `hg pull -u` may fail soft without failing first-boot
- [ ] Second boot: `ConditionPathExists=!/var/lib/rocky/first-boot.done` → first-boot skipped
- [ ] Destroy OS + recreate from same seed with **kept** `/vw` + tank → Gates 1–6 pass again (Path A)

```bash
hg -R /tank/rocky id -i
grep '^QCTL_ENV=' /etc/environment.d/91-rocky-env.conf
test -f /var/lib/rocky/first-boot.done && echo stamp_ok
# After reboot with stamp present, rocky-first-boot should be skipped:
systemctl status rocky-first-boot.service   # inactive / condition not met
```

---



## Gate 8 — Proxmox parity

- [ ] Same cloud-init intent (snippets or NoCloud) + OS + `/vw` + 5 data + 2 special
- [ ] Re-run Gates 1–7 on Proxmox
- [ ] Document deltas: network (`ipconfig0` vs seed `network-config`), disk serials/by-id, snippet paths

See `[cloud-init/README.md](cloud-init/README.md)` Proxmox section. Use `qctl vm --target proxmox …`.

---



## Quick lab sequence (happy path)

```bash
# Host
qctl vm seed
qctl vm init-tank          # once: create+export tank, keep disks
qctl vm up --wipe-os       # appliance first-boot → stamp

# Guest checks (Gates 1–5, 7)
test -f /var/lib/rocky/first-boot.done
findmnt /vw /tank
bw status
hg -R /tank/rocky id -i

# Gate 6
reboot
```

