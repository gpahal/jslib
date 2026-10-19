#!/usr/bin/env node
import { runCli } from '@/internal/cli'

process.exitCode = await runCli({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  manifestUrl: new URL('../package.json', import.meta.url),
})
