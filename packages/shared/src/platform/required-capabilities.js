/**
 * Capability keys every `@qctl/platform-*` packages map must define
 * (empty recipe allowed). Matches guest init profile vocabulary.
 */
export const REQUIRED_PLATFORM_CAPABILITIES = Object.freeze(
  /** @type {const} */ ([
    'curl',
    'jq',
    'unzip',
    'host-tools',
    'zfs',
    'xfsprogs',
    'pipx',
    'git',
    'mercurial',
    'podman',
    'firewalld',
    'openssh',
    'qemu-guest-agent',
    'cockpit',
  ]),
)

/**
 * @typedef {typeof REQUIRED_PLATFORM_CAPABILITIES[number]} RequiredPlatformCapability
 */
