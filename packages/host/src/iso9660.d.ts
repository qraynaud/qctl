declare module '@gcu/iso9660' {
  export class ISOWriter {
    constructor(opts?: {
      volumeId?: string
      publisher?: string
      preparer?: string
      application?: string
      joliet?: boolean
      greeting?: boolean
    })
    add(path: string, data: Uint8Array | ArrayBuffer): void
    toUint8Array(): Uint8Array
    toBlob(): Blob
  }

  export class ISOReader {
    constructor(arrayBuffer: ArrayBuffer)
    readonly volumeId: string
    readonly publisher: string
    readonly preparer: string
    readonly application: string
    readonly joliet: boolean
    list(opts?: { stat?: boolean; joliet?: boolean }): string[] | Array<{
      path: string
      size: number
      date: Date
      isDir: boolean
    }>
    read(path: string, opts?: { joliet?: boolean }): Uint8Array
  }
}
