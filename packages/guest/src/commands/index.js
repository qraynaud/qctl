import * as appProxy from './app-proxy.js'
import * as init from './init.js'
import * as list from './list.js'
import * as plugins from './plugins.js'
import * as quadlet from './quadlet.js'
import * as secret from './secret.js'
import * as stage from './stage.js'
import * as supervisor from './supervisor.js'

export const commands = [init, list, stage, plugins, supervisor, appProxy, quadlet, secret]
