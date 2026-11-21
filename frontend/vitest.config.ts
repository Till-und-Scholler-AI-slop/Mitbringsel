import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Node 25+ enables global localStorage/sessionStorage by default. Without
// --localstorage-file, globalThis.localStorage is undefined, and Vitest's jsdom
// environment skips globals that already exist on globalThis unless they are in
// its hardcoded override list. Disable Node's Web Storage in test workers when
// present so jsdom supplies localStorage and sessionStorage cleanly.
const nodeWebStorageExecArgv =
  'localStorage' in globalThis
    ? process.allowedNodeEnvironmentFlags.has('--webstorage')
      ? ['--no-webstorage']
      : process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
        ? ['--no-experimental-webstorage']
        : []
    : []

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      execArgv: nodeWebStorageExecArgv,
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
