#!/bin/bash
# Gate cloud-init on rocky-first-boot (qctl _internal_init) completing with a ready stamp.
#
# Invoked from cloud-init runcmd (after packages) and from scripts/per-boot so a
# reboot mid-seed cannot report cloud-init "done" while qctl _internal_init failed or never
# ran. Before the unit is enabled, per-boot exits 0 and defers to runcmd.
#
# Do NOT use `systemctl start --wait`: with Type=oneshot + RemainAfterExit=yes,
# --wait blocks until the unit stops again (forever). Plain `systemctl start`
# already waits for the oneshot ExecStart job to finish.
set -euo pipefail

STAMP="${ROCKY_STAMP_FILE:-/var/lib/rocky/first-boot.done}"
UNIT=rocky-first-boot.service

say() {
  # cloud-init may only tee runcmd to its log; mirror the gate to serial.
  echo "$*"
  echo "$*" >/dev/console 2>/dev/null || true
}

if [[ -f $STAMP ]]; then
  say "rocky-wait-qctl-init: stamp present ($STAMP) — qctl _internal_init already OK"
  exit 0
fi

# First boot: write_files installs the unit, but runcmd enables it only after
# packages. per-boot runs before runcmd — do not fail that early window.
if ! systemctl is-enabled --quiet "$UNIT" 2>/dev/null; then
  say "rocky-wait-qctl-init: $UNIT not enabled yet — defer to cloud-init runcmd"
  exit 0
fi

systemctl daemon-reload

say "rocky-wait-qctl-init: starting $UNIT (qctl _internal_init)…"
if ! systemctl start "$UNIT"; then
  say "rocky-wait-qctl-init: ERROR: $UNIT failed"
  systemctl status "$UNIT" --no-pager -l || true
  journalctl -u "$UNIT" -b --no-pager -n 80 || true
  exit 1
fi

if [[ ! -f $STAMP ]]; then
  say "rocky-wait-qctl-init: ERROR: $UNIT finished without stamp $STAMP"
  systemctl status "$UNIT" --no-pager -l || true
  journalctl -u "$UNIT" -b --no-pager -n 80 || true
  exit 1
fi

say "rocky-wait-qctl-init: OK — $STAMP"
say "Rocky cloud-init OK — qctl _internal_init stamped ($STAMP)"
cat "$STAMP" || true
