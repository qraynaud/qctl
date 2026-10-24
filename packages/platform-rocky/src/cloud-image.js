/**
 * Pinned Rocky 10 GenericCloud-Base (XFS) for `qctl vm download` / virt-install.
 * Bundled into `qctl-platform-rocky.mjs`; host loads `CLOUD_IMAGE` from that plugin.
 */
import pin from '../cloud-image.json' with { type: 'json' }

/**
 * @typedef {object} RockyCloudImage
 * @property {string} file
 * @property {string} url
 * @property {string} sha256
 */

/** @type {Readonly<RockyCloudImage>} */
export const CLOUD_IMAGE = Object.freeze({ ...pin })
