import adminUser from './admin-user.js'
import dataMounts from './data-mounts.js'
import hgClone from './hg-clone.js'
import hostBaseline from './host-baseline.js'
import networkUp from './network-up.js'
import poweroff from './poweroff.js'
import readyStamp from './ready-stamp.js'
import registryLogin from './registry-login.js'
import sshHostKeys from './ssh-host-keys.js'
import startServices from './start-services.js'
import tankCreate from './tank-create.js'
import tankImport from './tank-import.js'
import tier0Seal from './tier0-seal.js'
import vlanParents from './vlan-parents.js'
import zfsDrill from './zfs-drill.js'

/** @import { Stage } from './types.js' */

/** @type {ReadonlyArray<Stage>} */
const ALL = [
  vlanParents,
  networkUp,
  hostBaseline,
  dataMounts,
  tier0Seal,
  sshHostKeys,
  adminUser,
  startServices,
  registryLogin,
  tankImport,
  zfsDrill,
  hgClone,
  readyStamp,
  tankCreate,
  poweroff,
]

/** Static registry (no fs scan — `bun build --compile` sees every module). */
export const REGISTRY = new Map(ALL.map((s) => [s.name, s]))
