/**
 * Provision document types — derived only from Zod schemas (not YamlValue).
 * `YamlValue` stays in the YAML load/merge/`!env` layer; once we parse, input
 * and output types come from the schema.
 */
import type { z } from 'zod'

import type { PortEntry, PortsMap } from '@qctl/shared'

import type {
  disksBodySchema,
  disksDataVolumeSchema,
  disksMemberInSchema,
  disksOsSchema,
  disksTankSchema,
  disksVdevSchema,
} from './disks.js'
import type { filesItemSchema, filesSchema } from './files.js'
import type { registriesSchema } from './first-boot.js'
import type { ethernetVmSchema, networkingSchema } from './networking.js'
import type { packagesSchema } from './packages.js'
import type { provisionSchema } from './parse.js'
import type { proxmoxSchema, workstationSchema } from './targets.js'
import type { usersSchema } from './users.js'
import type { optionalCredentialBytes, optionalTrimmedText, trimmedText } from './zod-utils.js'

export type ProvisionFile = z.infer<typeof provisionSchema>
export type ProvisionFileInput = z.input<typeof provisionSchema>

export type { PortEntry, PortsMap }
export type Networking = z.infer<typeof networkingSchema>
export type EthernetVm = z.infer<typeof ethernetVmSchema>
/** `alignedVmNics` row: ethernet label + guest iface + optional host attach. */
export type AlignedVmNic = {
  label: string
  iface: string
  vm?: EthernetVm
}
export type WorkstationTarget = z.infer<typeof workstationSchema>
export type ProxmoxTarget = z.infer<typeof proxmoxSchema>
export type WorkstationInput = z.input<typeof workstationSchema>
export type ProxmoxInput = z.input<typeof proxmoxSchema>

/** Writer / wizard plain shapes (pre-default schema input; drop `.prefault` `| undefined`). */
export type PackagesInput = NonNullable<z.input<typeof packagesSchema>>
export type FilesInput = NonNullable<z.input<typeof filesSchema>>
export type FileItemInput = z.input<typeof filesItemSchema>
export type UsersInput = NonNullable<z.input<typeof usersSchema>>
/** Wizard always writes both accounts (markers allowed on password). */
export type UsersPlain = {
  admin: NonNullable<UsersInput['admin']>
  apps: NonNullable<UsersInput['apps']>
}
export type SshInput = NonNullable<ProvisionFileInput['ssh']>
export type RepoInput = NonNullable<ProvisionFileInput['repo']>
export type RegistriesInput = NonNullable<z.input<typeof registriesSchema>>

/** Pre-default `disks:` YAML shape (writer / deep-merge overlays). */
export type DisksInput = z.input<typeof disksBodySchema>
export type DisksOsInput = NonNullable<z.input<typeof disksOsSchema>>
export type DisksMemberInput = z.input<typeof disksMemberInSchema>
export type DisksDataVolumeInput = z.input<typeof disksDataVolumeSchema>
export type DisksVdevInput = z.input<typeof disksVdevSchema>

/**
 * Sparse profile overlay: size/id only (structure lives in common / env).
 * Leaves are {@link DisksMemberInput} / {@link DisksOsInput}.
 */
export type DisksAttachmentOverlay = {
  os?: DisksOsInput
  data?: Record<string, DisksMemberInput>
  tanks?: Record<string, { vdevs: Record<string, { members: Record<string, DisksMemberInput> }> }>
}
/** Resolved `!env` leaves are `Buffer`; schema inputs must accept them. */
type EnvBytes = Buffer

type AssertTrue<T extends true> = T

type _trimmedText = AssertTrue<EnvBytes extends z.input<typeof trimmedText> ? true : false>
type _optionalTrimmedText = AssertTrue<
  EnvBytes extends z.input<typeof optionalTrimmedText> ? true : false
>
type _optionalCredentialBytes = AssertTrue<
  EnvBytes extends z.input<typeof optionalCredentialBytes> ? true : false
>
type _registries = AssertTrue<
  EnvBytes extends NonNullable<z.input<typeof registriesSchema>>[number] ? true : false
>

type In = ProvisionFileInput
type _registriesRoot = AssertTrue<
  EnvBytes extends NonNullable<In['registries']>[number] ? true : false
>
type _tankPassphrase = AssertTrue<
  EnvBytes extends NonNullable<z.input<typeof disksTankSchema>['passphrase']> ? true : false
>
type _deployKey = AssertTrue<
  EnvBytes extends NonNullable<NonNullable<In['repo']>['deploy_key']> ? true : false
>
type _hostKeys = AssertTrue<
  EnvBytes extends NonNullable<NonNullable<In['ssh']>['host_keys']> ? true : false
>
/** List form and scalar form of `ssh.authorized_keys` both accept `!env` Buffer. */
type AuthorizedKeysIn = NonNullable<NonNullable<In['ssh']>['authorized_keys']>
type AuthorizedKeysList = Extract<AuthorizedKeysIn, readonly (string | EnvBytes)[]>
type AuthorizedKeysScalar = Exclude<AuthorizedKeysIn, readonly (string | EnvBytes)[]>
type _authorizedKeysList = AssertTrue<EnvBytes[] extends AuthorizedKeysList ? true : false>
type _authorizedKeysScalar = AssertTrue<EnvBytes extends AuthorizedKeysScalar ? true : false>
