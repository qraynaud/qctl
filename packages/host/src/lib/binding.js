/**
 * Credential slots for provision fields: static literal | secret (!env) | omit.
 * Flag form: `static:<value>` | `secret:<NAME>` | `secret:<NAME>:<encoding>` | `omit`
 */
import * as clack from '@clack/prompts'

import { ensureLine, lineMatchesKey, parseLines, replaceByKey } from './line-edit.js'

/** @typedef {'static' | 'secret' | 'omit'} BindingKind */
/** @typedef {'utf8' | 'base64' | 'hex' | 'latin1' | 'ascii'} EnvEncoding */

/**
 * @typedef {object} StaticBinding
 * @property {'static'} kind
 * @property {string} value
 */

/**
 * @typedef {object} SecretBinding
 * @property {'secret'} kind
 * @property {string} name
 * @property {EnvEncoding} encoding
 * @property {string} [value] Value to write into provision/.env.<env> when set now
 */

/**
 * @typedef {object} OmitBinding
 * @property {'omit'} kind
 */

/** @typedef {StaticBinding | SecretBinding | OmitBinding} CredentialBinding */

/** UPPER_SNAKE_CASE secret names (`TANK_PASSPHRASE`, `SSH_HOST_KEYS`, …). */
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/

/** @type {ReadonlySet<string>} */
export const BINDING_ENCODINGS = Object.freeze(
  new Set(['utf8', 'base64', 'hex', 'latin1', 'ascii']),
)

/**
 * @param {string} name
 * @returns {string}
 */
export function assertSecretName(name) {
  const n = String(name ?? '').trim()
  if (!SECRET_NAME_RE.test(n)) {
    throw new Error(
      `secret name ${JSON.stringify(name)} must be UPPER_SNAKE_CASE ` + `(${SECRET_NAME_RE})`,
    )
  }
  return n
}

/**
 * @param {string} encoding
 * @returns {EnvEncoding}
 */
export function assertEncoding(encoding) {
  const enc = String(encoding ?? 'utf8')
    .trim()
    .toLowerCase()
  if (!BINDING_ENCODINGS.has(enc)) {
    throw new Error(
      `encoding ${JSON.stringify(encoding)} must be one of ${[...BINDING_ENCODINGS].join(', ')}`,
    )
  }
  return /** @type {EnvEncoding} */ (enc)
}

/**
 * Parse a CLI slot flag value.
 * @param {string} raw
 * @returns {CredentialBinding}
 */
export function parseBindingFlag(raw) {
  const s = String(raw ?? '').trim()
  if (s === '' || s === 'omit') return { kind: 'omit' }
  if (s.startsWith('static:')) {
    return { kind: 'static', value: s.slice('static:'.length) }
  }
  if (s.startsWith('secret:')) {
    const rest = s.slice('secret:'.length)
    const colon = rest.lastIndexOf(':')
    if (colon > 0) {
      const maybeEnc = rest.slice(colon + 1).toLowerCase()
      if (BINDING_ENCODINGS.has(maybeEnc)) {
        return {
          kind: 'secret',
          name: assertSecretName(rest.slice(0, colon)),
          encoding: /** @type {EnvEncoding} */ (maybeEnc),
        }
      }
    }
    return { kind: 'secret', name: assertSecretName(rest), encoding: 'utf8' }
  }
  throw new Error(
    `invalid binding ${JSON.stringify(raw)}: use static:<value>, secret:<NAME>, `
      + `secret:<NAME>:<encoding>, or omit`,
  )
}

/**
 * YAML tag / scalar for a secret binding (`!env NAME` or mapping form).
 * @param {SecretBinding} binding
 * @returns {string}
 */
export function formatEnvTag(binding) {
  const name = assertSecretName(binding.name)
  const encoding = assertEncoding(binding.encoding ?? 'utf8')
  if (encoding === 'utf8') return `!env ${name}`
  return `!env { name: ${name}, encoding: ${encoding} }`
}

/**
 * Value side for YAML (caller prefixes `key: `).
 * @param {Exclude<CredentialBinding, OmitBinding>} binding
 * @returns {string}
 */
export function formatYamlValue(binding) {
  if (binding.kind === 'static') return binding.value
  return formatEnvTag(binding)
}

/**
 * Ensure `NAME=` exists in a `.env.schema` body (add-only; keep existing).
 * @param {string} schemaText
 * @param {string} name
 * @param {{ optional?: boolean, isPublic?: boolean }} [opts]
 * @returns {{ text: string, changed: boolean }}
 */
export function ensureSchemaSecret(schemaText, name, opts = {}) {
  const n = assertSecretName(name)
  const { lines, endsWithNl } = parseLines(schemaText)
  if (lines.some((l) => lineMatchesKey(l, n, 'env'))) {
    return {
      text: schemaText.endsWith('\n') || schemaText === '' ? schemaText : `${schemaText}\n`,
      changed: false,
    }
  }
  /** @type {string[]} */
  const block = []
  if (opts.isPublic) block.push('# @public')
  if (opts.optional) block.push('# @optional')
  block.push(`${n}=`)
  let text = schemaText
  for (const line of block) {
    const r = ensureLine(text, line)
    text = r.text
  }
  void endsWithNl
  return { text, changed: true }
}

/**
 * Set or add `NAME=value` in a provision env file (does not wipe other keys).
 * @param {string} envText
 * @param {string} name
 * @param {string} value
 * @returns {{ text: string, changed: boolean }}
 */
export function ensureEnvValue(envText, name, value) {
  const n = assertSecretName(name)
  const newLine = `${n}=${value}`
  const r = replaceByKey(envText, n, newLine, { createIfMissing: true })
  return { text: r.text, changed: r.changed }
}

/**
 * @template {string} [T=string]
 * @typedef {object} PromptOption
 * @property {T} value
 * @property {string} label
 * @property {string} [hint]
 */

/**
 * @template {string} [T=string]
 * @typedef {object} SelectPromptOpts
 * @property {string} message
 * @property {PromptOption<T>[]} options
 * @property {T} [initialValue]
 */

/**
 * @typedef {object} TextPromptOpts
 * @property {string} message
 * @property {string} [initialValue]
 * @property {string} [placeholder]
 * @property {(value: string | undefined) => string | Error | undefined} [validate]
 */

/**
 * @typedef {object} ConfirmPromptOpts
 * @property {string} message
 * @property {boolean} [initialValue]
 */

/**
 * @template {string} [T=string]
 * @typedef {object} MultiselectPromptOpts
 * @property {string} message
 * @property {PromptOption<T>[]} options
 * @property {T[]} [initialValues]
 * @property {boolean} [required]
 */

/**
 * Values {@link BindingPrompts} may pass to `isCancel` when option values ⊆ `T`.
 * Includes `string` / `boolean` for `text` / `confirm` results.
 * @template {string} [T=string]
 * @typedef {T | T[] | string | boolean | symbol | null | undefined} PromptCancelable
 */

/**
 * Minimal Clack surface for init wizards (cancel → `symbol`).
 *
 * `T` is an upper bound on `select` / `multiselect` option values (default
 * `string` for a shared wizard `p`). Each call still infers its own `U extends T`;
 * `isCancel` accepts {@link PromptCancelable}`<T>` so it stays in sync with that bound.
 *
 * @template {string} [T=string]
 * @typedef {object} BindingPrompts
 * @property {<U extends T>(opts: SelectPromptOpts<U>) => Promise<U | symbol>} select
 * @property {(opts: TextPromptOpts) => Promise<string | symbol>} text
 * @property {(opts: ConfirmPromptOpts) => Promise<boolean | symbol>} confirm
 * @property {<U extends T>(opts: MultiselectPromptOpts<U>) => Promise<U[] | symbol>} [multiselect]
 * @property {{ step?: (message: string) => void }} [log]
 * @property {(value: PromptCancelable<T>) => boolean} isCancel
 * @property {(message?: string) => void} [cancel]
 */

/**
 * Coerce Clack (or a test double) to {@link BindingPrompts} (default `T = string`).
 * @param {BindingPrompts | typeof clack} prompts
 * @returns {BindingPrompts}
 */
export function asBindingPrompts(prompts) {
  return /** @type {BindingPrompts} */ (/** @type {never} */ (prompts))
}

/**
 * @typedef {object} PromptCredentialBindingOpts
 * @property {string} message
 * @property {boolean} [allowOmit]
 * @property {string} [omitLabel] Clack label when omit is allowed
 * @property {BindingKind} [initialKind]
 * @property {string} [suggestSecretName]
 * @property {boolean} [askEncoding] When secret: offer encoding (default utf8 / base64)
 * @property {boolean} [askValueNow] When secret: offer to set value in .env now
 * @property {string} [staticInitial] Prefill for static value
 * @property {BindingPrompts} [prompts]
 */

/**
 * Interactive static | secret | omit (Clack).
 * @param {PromptCredentialBindingOpts} opts
 * @returns {Promise<CredentialBinding | symbol>} Binding, or Clack cancel symbol
 */
export async function promptCredentialBinding(opts) {
  const p = asBindingPrompts(opts.prompts ?? clack)
  const allowOmit = opts.allowOmit !== false

  /**
   * @param {PromptCancelable} value
   * @returns {symbol | null}
   */
  const cancelOrNull = (value) => (p.isCancel(value) ? /** @type {symbol} */ (value) : null)

  /** @type {{ value: BindingKind, label: string }[]} */
  const options = [
    { value: 'static', label: 'Static value (literal in YAML)' },
    { value: 'secret', label: 'Secret (!env name in YAML)' },
  ]
  if (allowOmit) {
    options.push({
      value: 'omit',
      label: opts.omitLabel ?? 'Omit (use defaults / skip)',
    })
  }

  const kind = await p.select({
    message: opts.message,
    options,
    initialValue: opts.initialKind ?? (allowOmit ? undefined : 'static'),
  })
  {
    const c = cancelOrNull(kind)
    if (c) return c
  }

  if (kind === 'omit') return { kind: 'omit' }

  if (kind === 'static') {
    const value = await p.text({
      message: 'Value',
      initialValue: opts.staticInitial ?? '',
      validate: (v) => (v === undefined || v === '' ? 'Value required' : undefined),
    })
    {
      const c = cancelOrNull(value)
      if (c) return c
    }
    return { kind: 'static', value: String(value) }
  }

  const nameRaw = await p.text({
    message: 'Secret name (UPPER_SNAKE_CASE)',
    initialValue: opts.suggestSecretName ?? '',
    validate: (v) => {
      try {
        assertSecretName(String(v ?? ''))
        return undefined
      } catch (err) {
        return err instanceof Error ? err.message : String(err)
      }
    },
  })
  {
    const c = cancelOrNull(nameRaw)
    if (c) return c
  }
  const name = assertSecretName(String(nameRaw))

  /** @type {EnvEncoding} */
  let encoding = 'utf8'
  if (opts.askEncoding) {
    const enc = await p.select({
      message: `Encoding for ${name}`,
      options: [
        { value: 'utf8', label: 'utf8 (default)' },
        { value: 'base64', label: 'base64 (multiline / binary)' },
        { value: 'hex', label: 'hex' },
        { value: 'latin1', label: 'latin1' },
        { value: 'ascii', label: 'ascii' },
      ],
      initialValue: 'utf8',
    })
    {
      const c = cancelOrNull(enc)
      if (c) return c
    }
    encoding = assertEncoding(String(enc))
  }

  /** @type {SecretBinding} */
  const binding = { kind: 'secret', name, encoding }
  if (opts.askValueNow) {
    const setNow = await p.confirm({
      message: `Set ${name} value now for this env?`,
      initialValue: true,
    })
    {
      const c = cancelOrNull(setNow)
      if (c) return c
    }
    if (setNow) {
      const value = await p.text({
        message: `${name}=`,
        initialValue: '',
      })
      {
        const c = cancelOrNull(value)
        if (c) return c
      }
      binding.value = String(value ?? '')
    }
  }
  return binding
}
