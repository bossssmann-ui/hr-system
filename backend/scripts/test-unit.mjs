#!/usr/bin/env bun

import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const srcDir = join(root, 'src')
const testFiles = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      walk(fullPath)
      continue
    }
    if (!entry.endsWith('.test.ts')) continue
    if (entry.endsWith('.integration.test.ts')) continue
    testFiles.push(relative(root, fullPath))
  }
}

walk(srcDir)
testFiles.sort()

if (testFiles.length === 0) {
  console.error('No unit test files found.')
  process.exit(1)
}

const result = spawnSync('bun', ['test', ...testFiles], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
