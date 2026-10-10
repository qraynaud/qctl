declare module 'nunjucks' {
  export class Environment {
    render(name: string, context?: Record<string, unknown>): string
    renderString(src: string, context?: Record<string, unknown>): string
    addFilter(name: string, fn: (...args: never[]) => unknown): this
  }
  export function renderString(src: string, context?: Record<string, unknown>): string
  export function configure(path?: string | string[], opts?: Record<string, unknown>): Environment
  const nunjucks: {
    renderString: typeof renderString
    configure: typeof configure
    Environment: typeof Environment
  }
  export default nunjucks
}
