// Native modules are rebuilt for Electron's ABI, so Vitest runs under Electron's bundled Node.
import { spawnSync } from 'node:child_process'
import electron from 'electron'

const { status } = spawnSync(
  electron,
  ['node_modules/vitest/vitest.mjs', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)
process.exit(status ?? 1)
