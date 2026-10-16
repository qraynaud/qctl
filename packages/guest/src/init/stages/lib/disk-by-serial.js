/** @import { StageContext } from '../../context.js' */

/**
 * Resolve a block device path by guest serial / by-id substring.
 * @param {StageContext} ctx
 * @param {string} serial
 * @returns {Promise<string>}
 */
export async function diskBySerial(ctx, serial) {
  const byId = await ctx.exec([
    'bash',
    '-c',
    `serial="$1"
     for c in /dev/disk/by-id/*"$serial"*; do
       [[ -e "$c" && ! "$c" =~ -part[0-9]+$ ]] || continue
       readlink -f "$c"
       exit 0
     done
     exit 1`,
    'disk-by-serial',
    serial,
  ])
  if (byId.code === 0 && byId.stdout.trim()) return byId.stdout.trim()

  const lsblk = await ctx.exec(['lsblk', '-ndo', 'NAME,SERIAL,TYPE'])
  for (const line of (lsblk.stdout || '').split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const [name, ser, type] = parts
    if (ser === serial && type === 'disk') return `/dev/${name}`
  }
  throw new Error(`missing disk serial ${serial}`)
}
