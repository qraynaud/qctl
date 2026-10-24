/** Default Mercurial toolchain (pipx) when `repo.vcs: hg`. */
export const MERCURIAL_PIPX_DEFAULT = Object.freeze({
  package: 'mercurial==7.2.4',
  inject: Object.freeze(['hg-evolve==12.0.0']),
})
