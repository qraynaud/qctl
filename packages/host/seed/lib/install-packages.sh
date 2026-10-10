#!/usr/bin/env bash
# Install provision `packages.{distro,pipx,http}` from /usr/local/lib/rocky/packages.json
# (written by `qctl vm seed`). Runs from cloud-init after the platform baseline dnf set.
set -euo pipefail

log() { echo "rocky-packages: $*"; }
die() { echo "rocky-packages: ERROR: $*" >&2; exit 1; }

MANIFEST="${ROCKY_PACKAGES_JSON:-/usr/local/lib/rocky/packages.json}"
BIN_DIR="${ROCKY_PACKAGES_BIN_DIR:-/usr/local/bin}"

[[ "$(id -u)" -eq 0 ]] || die "must run as root"
[[ -f "$MANIFEST" ]] || {
  log "no $MANIFEST — nothing to install"
  exit 0
}
command -v jq >/dev/null || die "jq required"

install_distro() {
  local n
  n="$(jq -r '.distro // [] | length' "$MANIFEST")"
  ((n > 0)) || return 0
  log "distro: installing $n package(s) via dnf"
  # shellcheck disable=SC2046
  dnf install -y $(jq -r '.distro[]' "$MANIFEST")
}

# pipx venv name is the distribution name, not the install spec
# (e.g. mercurial==7.1.2 → mercurial). Inject must use that name.
pipx_venv_name() {
  local spec="${1%%[*}" # drop extras […]
  # drop version pins (==, >=, <=, ~=, !=, >, <)
  echo "${spec%%[=<>!~]*}"
}

ensure_pipx() {
  command -v pipx >/dev/null && return 0
  log "pipx: not on PATH — installing via dnf (packages.pipx is non-empty)"
  command -v dnf >/dev/null || die "dnf required to install pipx for packages.pipx"
  dnf install -y pipx
  command -v pipx >/dev/null || die "pipx still missing after dnf install"
}

install_pipx() {
  local n i pkg venv
  n="$(jq -r '.pipx // [] | length' "$MANIFEST")"
  ((n > 0)) || return 0
  ensure_pipx
  export PIPX_HOME="${PIPX_HOME:-/opt/pipx}"
  export PIPX_BIN_DIR="${PIPX_BIN_DIR:-$BIN_DIR}"
  mkdir -p "$PIPX_HOME" "$PIPX_BIN_DIR"
  for ((i = 0; i < n; i++)); do
    pkg="$(jq -r --argjson i "$i" '.pipx[$i].package' "$MANIFEST")"
    [[ -n "$pkg" && "$pkg" != null ]] || continue
    venv="$(pipx_venv_name "$pkg")"
    [[ -n "$venv" ]] || die "could not derive pipx venv name from $pkg"
    log "pipx: install $pkg"
    pipx install --force "$pkg"
    while IFS= read -r inj; do
      [[ -n "$inj" ]] || continue
      log "pipx: inject $venv ← $inj"
      pipx inject "$venv" "$inj"
    done < <(jq -r --argjson i "$i" '.pipx[$i].inject // [] | .[]' "$MANIFEST")
  done
}

# Zip → extract member named $bin (or basename of dest); raw URL → dest/bin path.
# Optional test: bash -c expression with APP=installed path (must exit 0).
install_http_one() {
  local url="$1" bin="$2" dest="$3" test="$4"
  local out tmp member
  if [[ -n "$dest" && "$dest" != null ]]; then
    out="$dest"
  elif [[ -n "$bin" && "$bin" != null ]]; then
    out="$BIN_DIR/$bin"
  else
    die "http entry missing bin and dest ($url)"
  fi
  member="${bin:-$(basename "$out")}"
  tmp="$(mktemp -d)"
  log "http: $url → $out"
  curl -fsSL -o "$tmp/payload" "$url"
  mkdir -p "$(dirname "$out")"
  if unzip -t "$tmp/payload" >/dev/null 2>&1; then
    unzip -qo "$tmp/payload" -d "$tmp/extract"
    if [[ -f "$tmp/extract/$member" ]]; then
      install -m 0755 "$tmp/extract/$member" "$out"
    else
      local only
      only="$(find "$tmp/extract" -type f | head -1)"
      [[ -n "$only" ]] || die "zip from $url had no files"
      install -m 0755 "$only" "$out"
    fi
  else
    install -m 0755 "$tmp/payload" "$out"
  fi
  rm -rf "$tmp"
  if [[ -n "$test" && "$test" != null ]]; then
    log "http: test $test (APP=$out)"
    if ! APP="$out" bash -c "$test"; then
      die "http test failed for $out: $test"
    fi
  fi
}

install_http() {
  local n i
  n="$(jq -r '.http // [] | length' "$MANIFEST")"
  ((n > 0)) || return 0
  command -v curl >/dev/null || die "curl required for packages.http"
  command -v unzip >/dev/null || die "unzip required for packages.http zips"
  for ((i = 0; i < n; i++)); do
    install_http_one \
      "$(jq -r --argjson i "$i" '.http[$i].url' "$MANIFEST")" \
      "$(jq -r --argjson i "$i" '.http[$i].bin // empty' "$MANIFEST")" \
      "$(jq -r --argjson i "$i" '.http[$i].dest // empty' "$MANIFEST")" \
      "$(jq -r --argjson i "$i" '.http[$i].test // empty' "$MANIFEST")"
  done
}

main() {
  log "start ($MANIFEST)"
  install_distro
  install_http
  install_pipx
  log "done"
}

main "$@"
