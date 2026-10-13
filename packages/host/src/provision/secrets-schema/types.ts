/**
 * Provision secrets types — derived only from Zod schemas (not YamlValue).
 * `YamlValue` stays in the YAML load/merge/`!env` layer; once we parse, input
 * and output types come from the schema.
 */
import type { z } from 'zod'

import type { registriesSchema } from './first-boot.js'
import type { secretsFileSchema } from './parse.js'
import type { optionalCredentialBytes, optionalTrimmedText, trimmedText } from './zod-utils.js'

export type SecretsFile = z.infer<typeof secretsFileSchema>
export type SecretsFileInput = z.input<typeof secretsFileSchema>

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

type In = SecretsFileInput
type _registriesRoot = AssertTrue<
  EnvBytes extends NonNullable<In['registries']>[number] ? true : false
>
type _tankPassphrase = AssertTrue<
  EnvBytes extends NonNullable<NonNullable<In['tank']>['passphrase']> ? true : false
>
type _deployKey = AssertTrue<
  EnvBytes extends NonNullable<NonNullable<In['repo']>['deploy_key']> ? true : false
>
type _hostKeys = AssertTrue<
  EnvBytes extends NonNullable<NonNullable<In['ssh']>['host_keys']> ? true : false
>
/** List form and scalar form of `ssh.authorized_keys` both accept `!env` Buffer. */
type AuthorizedKeysIn = NonNullable<NonNullable<In['ssh']>['authorized_keys']>
type _authorizedKeysList = AssertTrue<
  EnvBytes[] extends Extract<AuthorizedKeysIn, readonly unknown[]> ? true : false
>
type _authorizedKeysScalar = AssertTrue<
  EnvBytes extends Exclude<AuthorizedKeysIn, readonly unknown[]> ? true : false
>
