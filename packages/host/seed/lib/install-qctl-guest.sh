#!/usr/bin/env bash
# Install guest qctl tooling from the NoCloud seed (embedded by `qctl vm seed` under
# qctl-guest/ on the cidata volume) — runs first in cloud-init runcmd, before the
# units that exec `qctl _internal_init`.
#
# Installs:
#   qctl-guest                 → /usr/local/bin/qctl                (guest build; stages / quadlet / secret)
#   qctl-platform-<id>.mjs     → /usr/local/lib/qctl/…  (thin platform; guest import())
#   QCTL_PLATFORM_MODULE       → /etc/environment.d/90-qctl-platform.conf
#   quadlet                    → /usr/local/bin/quadlet             (thin → qctl quadlet)
#   varlock-local-encrypt      → /usr/local/bin/varlock-local-encrypt  (SEA sibling for qctl)
#   (first-boot secrets are Tier-0 LoadCredentialEncrypted from provision seed — no bootstrap/)
#   bash-completion            → /usr/share/bash-completion/completions/quadlet
#
# No varlock CLI — guest uses the graph API embedded in `qctl-guest` (installed as `qctl`).
#
# Override the source dir with QCTL_GUEST_SRC (tests / manual re-install).
# Override the instance root for the quadlet wrapper with QCTL_ROOT (default /tank/rocky).
set -euo pipefail

log() { echo "rocky-install-qctl: $*"; }
die() { echo "rocky-install-qctl: ERROR: $*" >&2; exit 1; }

BIN_DIR="${QCTL_BIN_DIR:-/usr/local/bin}"
LIB_DIR="${QCTL_LIB_DIR:-/usr/local/lib/qctl}"
COMPLETIONS_DIR="${QCTL_COMPLETIONS_DIR:-/usr/share/bash-completion/completions}"
INSTANCE_ROOT="${QCTL_ROOT:-/tank/rocky}"
MNT=""

cleanup() {
  if [[ -n "$MNT" ]] && mountpoint -q "$MNT" 2>/dev/null; then
    umount "$MNT" || true
  fi
  [[ -n "$MNT" ]] && rmdir "$MNT" 2>/dev/null || true
}
trap cleanup EXIT

find_src() {
  if [[ -n "${QCTL_GUEST_SRC:-}" ]]; then
    printf '%s' "$QCTL_GUEST_SRC"
    return
  fi
  local dev
  dev="$(blkid -L cidata 2>/dev/null || blkid -L CIDATA 2>/dev/null || true)"
  [[ -n "$dev" ]] || die "no NoCloud volume (LABEL=cidata) — was the seed attached?"
  MNT="$(mktemp -d)"
  mount -o ro "$dev" "$MNT"
  printf '%s' "$MNT/qctl-guest"
}

main() {
  [[ "$(id -u)" -eq 0 ]] || die "must run as root"
  local src
  src="$(find_src)"
  [[ -x "$src/qctl-guest" ]] \
    || die "missing qctl-guest under $src (run 'bun run compile' in qctl, then re-seed)"
  local -a mods=()
  local f
  for f in "$src"/qctl-platform-*.mjs; do
    [[ -f "$f" ]] && mods+=("$f")
  done
  ((${#mods[@]} == 1)) \
    || die "expected exactly one qctl-platform-*.mjs under $src (found ${#mods[@]})"
  local mod_base
  mod_base="$(basename "${mods[0]}")"

  mkdir -p "$BIN_DIR" "$LIB_DIR/bootstrap" "$COMPLETIONS_DIR" /etc/environment.d
  install -m 0755 "$src/qctl-guest" "$BIN_DIR/qctl"
  install -m 0644 "${mods[0]}" "$LIB_DIR/$mod_base"
  printf 'QCTL_PLATFORM_MODULE=%s\n' "$LIB_DIR/$mod_base" \
    > /etc/environment.d/90-qctl-platform.conf
  # Drop legacy platform SEA / hard-coded rocky module if an older seed left one behind.
  rm -f "$LIB_DIR/qctl-platform-rocky" "$BIN_DIR/qctl-platform-rocky"
  log "installed $BIN_DIR/qctl (from qctl-guest) + $LIB_DIR/$mod_base"

  # Convenience alias — keeps muscle memory / CI; real CLI is `qctl quadlet`.
  cat >"$BIN_DIR/quadlet" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export QCTL_ROOT="\${QCTL_ROOT:-${INSTANCE_ROOT}}"
exec "${BIN_DIR}/qctl" quadlet "\$@"
EOF
  chmod 0755 "$BIN_DIR/quadlet"
  log "installed $BIN_DIR/quadlet → qctl quadlet (QCTL_ROOT default ${INSTANCE_ROOT})"

  cat >"$COMPLETIONS_DIR/quadlet" <<'EOF'
# bash-completion for /usr/local/bin/quadlet → qctl quadlet
_quadlet_apps() {
  local repo=${QCTL_ROOT:-/tank/rocky} d
  [[ -d "$repo/applications" ]] || return 0
  for d in "$repo/applications"/*/app.yaml; do
    [[ -f "$d" ]] || continue
    basename "$(dirname "$d")"
  done
}
_quadlet() {
  local cur cmd
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  if [[ $COMP_CWORD -eq 1 ]]; then
    mapfile -t COMPREPLY < <(compgen -W "up down enable start stop restart ps help" -- "$cur")
    return 0
  fi
  cmd="${COMP_WORDS[1]}"
  case "$cmd" in
    up | down | enable | start | stop | restart | ps)
      if [[ "$cur" == -* ]]; then
        case "$cmd" in
          up) mapfile -t COMPREPLY < <(compgen -W "--dry-run -n --root --help" -- "$cur") ;;
          enable) mapfile -t COMPREPLY < <(compgen -W "--no-install --root --help" -- "$cur") ;;
          *) mapfile -t COMPREPLY < <(compgen -W "--root --help" -- "$cur") ;;
        esac
      else
        mapfile -t COMPREPLY < <(compgen -W "$(_quadlet_apps)" -- "$cur")
      fi
      ;;
  esac
  return 0
}
complete -F _quadlet quadlet
EOF
  log "installed $COMPLETIONS_DIR/quadlet"

  # SEA sibling of guest `qctl` — embedded varlock graph API uses this for disk cache.
  if [[ -f "$src/varlock-local-encrypt" ]]; then
    install -m 0755 "$src/varlock-local-encrypt" "$BIN_DIR/varlock-local-encrypt"
    log "installed $BIN_DIR/varlock-local-encrypt"
  else
    log "WARN: varlock-local-encrypt missing from seed — disk cache may fall back to memory"
  fi

  # Optional legacy bootstrap/ on seed (ignored for first-boot; secrets are Tier-0).
  if [[ -d "$src/bootstrap" ]]; then
    log "WARN: seed still has bootstrap/ — deprecated; first-boot uses provision → Tier-0"
  fi
}

main "$@"
