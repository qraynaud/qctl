/**
 * Minimal typings for ssh2 (avoid @types/ssh2 → @types/node, which fights Bun).
 */
declare module 'ssh2' {
  import type { EventEmitter } from 'node:events'

  export interface ConnectConfig {
    host?: string
    port?: number
    username?: string
    privateKey?: Buffer | string
    agent?: string
    readyTimeout?: number
    hostVerifier?: (hashedKey: string) => boolean
  }

  export interface ExecStream extends EventEmitter {
    stderr: EventEmitter
  }

  export interface SFTPWrapper {
    fastPut(
      localPath: string,
      remotePath: string,
      callback: (err: Error | null | undefined) => void,
    ): void
  }

  export class Client extends EventEmitter {
    connect(config: ConnectConfig): this
    end(): void
    exec(
      command: string,
      callback: (err: Error | undefined | null, stream: ExecStream) => void,
    ): this
    sftp(callback: (err: Error | undefined | null, sftp: SFTPWrapper) => void): this
  }
}
