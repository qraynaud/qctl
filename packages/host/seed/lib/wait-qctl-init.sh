#!/bin/bash
# Gate cloud-init on rocky-first-boot (qctl _internal_init) completing with a ready stamp.
#
# Invoked from cloud-init runcmd and from scripts/per-boot so a reboot mid-seed
# cannot report cloud-init "done" while qctl _internal_init failed or never ran.
# Before the unit is enabled, per-boot exits 0 and defers to runcmd.
#
# Do NOT use blocking `systemctl start` / `start --wait`:
# - `start --wait` + RemainAfterExit=yes waits forever (unit stays "active").
# - blocking `start` dies with "D-Bus connection terminated" when the oneshot
#   upgrades systemd/glibc — while qctl is still activating — and cloud-init
#   falsely fails (scripts_user). Use --no-block + poll the stamp instead.
set -euo pipefail

STAMP="${QCTL_STAMP_FILE:-/var/lib/qctl/first-boot.done}"
UNIT=rocky-first-boot.service
# First-boot packages + stages; override if needed.
TIMEOUT_SEC="${QCTL_WAIT_INIT_TIMEOUT:-3600}"

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
# install-qctl-guest. per-boot runs before runcmd — do not fail that early window.
if ! systemctl is-enabled --quiet "$UNIT" 2>/dev/null; then
  say "rocky-wait-qctl-init: $UNIT not enabled yet — defer to cloud-init runcmd"
  exit 0
fi

systemctl daemon-reload || true

say "rocky-wait-qctl-init: starting $UNIT (qctl _internal_init)…"
# Ignore start exit: D-Bus may reset during a distro upgrade inside the oneshot.
systemctl start --no-block "$UNIT" 2>/dev/null || true

deadline=$((SECONDS + TIMEOUT_SEC))
saw_start=0
while ((SECONDS < deadline)); do
  if [[ -f $STAMP ]]; then
    say "rocky-wait-qctl-init: OK — $STAMP"
    say "Rocky cloud-init OK — qctl _internal_init stamped ($STAMP)"
    cat "$STAMP" || true
    exit 0
  fi

  state=$(systemctl is-active "$UNIT" 2>/dev/null || echo unknown)
  case $state in
    activating | active | reloading)
      saw_start=1
      ;;
    failed)
      say "rocky-wait-qctl-init: ERROR: $UNIT failed"
      systemctl status "$UNIT" --no-pager -l || true
      journalctl -u "$UNIT" -b --no-pager -n 80 || true
      exit 1
      ;;
    inactive | dead)
      if ((saw_start)); then
        say "rocky-wait-qctl-init: ERROR: $UNIT finished without stamp $STAMP"
        systemctl status "$UNIT" --no-pager -l || true
        journalctl -u "$UNIT" -b --no-pager -n 80 || true
        exit 1
      fi
      # Not started yet (or lost after a systemd reexec) — kick again.
      systemctl start --no-block "$UNIT" 2>/dev/null || true
      ;;
    *)
      # Transient D-Bus / reexec blip — keep polling.
      ;;
  esac
  sleep 2
done

say "rocky-wait-qctl-init: ERROR: timed out after ${TIMEOUT_SEC}s waiting for $STAMP"
systemctl status "$UNIT" --no-pager -l || true
journalctl -u "$UNIT" -b --no-pager -n 80 || true
exit 1
