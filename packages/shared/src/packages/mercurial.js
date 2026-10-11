/** Default Mercurial toolchain (pipx) when `repo.vcs: hg`. */
export const MERCURIAL_PIPX_DEFAULT = Object.freeze({
  package: 'mercurial==7.1.2',
  inject: Object.freeze(['hg-evolve==11.1.9']),
})
