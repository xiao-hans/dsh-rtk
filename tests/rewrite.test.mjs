import test from 'node:test'
import assert from 'node:assert/strict'
import {
  windowsCompatibilityMap,
  postProcessRewritten,
  runRtkRewrite,
  resolveRtkCommand,
  withRtkDbEnv
} from '../lib/rewrite.js'

test('windowsCompatibilityMap maps ls to rtk find', () => {
  assert.equal(windowsCompatibilityMap('ls'), 'rtk find . -maxdepth 1')
  assert.equal(windowsCompatibilityMap('ls src'), 'rtk find src -maxdepth 1')
  assert.equal(windowsCompatibilityMap('ls -la'), 'rtk find . -maxdepth 1')
})

test('windowsCompatibilityMap maps dir to rtk find', () => {
  assert.equal(windowsCompatibilityMap('dir'), 'rtk find . -maxdepth 1')
  assert.equal(windowsCompatibilityMap('dir .'), 'rtk find . -maxdepth 1')
})

test('windowsCompatibilityMap maps cat/type to rtk read', () => {
  assert.equal(windowsCompatibilityMap('cat file.txt'), 'rtk read file.txt')
  assert.equal(windowsCompatibilityMap('type file.txt'), 'rtk read file.txt')
})

test('windowsCompatibilityMap leaves other commands untouched', () => {
  assert.equal(windowsCompatibilityMap('git status'), 'git status')
  assert.equal(windowsCompatibilityMap('cargo test'), 'cargo test')
})

test('postProcessRewritten fixes rtk ls', () => {
  assert.equal(postProcessRewritten('rtk ls'), 'rtk find . -maxdepth 1')
  assert.equal(postProcessRewritten('rtk ls src'), 'rtk find src -maxdepth 1')
  assert.equal(postProcessRewritten('rtk ls -la'), null)
})

test('postProcessRewritten leaves normal rtk commands alone', () => {
  assert.equal(postProcessRewritten('rtk git status'), 'rtk git status')
  assert.equal(postProcessRewritten('rtk find . -maxdepth 2'), 'rtk find . -maxdepth 2')
})

test('resolveRtkCommand uses rtk rewrite when available', async () => {
  const ctx = {
    shell: {
      resolve: (request) => request,
      async run(request) {
        assert.equal(request.command, 'rtk rewrite \'git status\'')
        return {
          exitCode: 0,
          stdout: { text: 'rtk git status', truncated: false },
          stderr: { text: '', truncated: false }
        }
      }
    }
  }

  const result = await resolveRtkCommand(ctx, 'git status')
  assert.equal(result, 'rtk git status')
})

test('resolveRtkCommand uses Windows mapping directly', async () => {
  const ctx = {
    shell: {
      resolve: (request) => request,
      async run() {
        throw new Error('should not call rtk rewrite for mapped ls')
      }
    }
  }

  const result = await resolveRtkCommand(ctx, 'ls src')
  assert.equal(result, 'rtk find src -maxdepth 1')
})

test('resolveRtkCommand passes through already-rtk commands', async () => {
  const ctx = {
    shell: {
      resolve: (request) => request,
      async run() {
        throw new Error('should not call rtk rewrite for rtk command')
      }
    }
  }

  const result = await resolveRtkCommand(ctx, 'rtk git status')
  assert.equal(result, 'rtk git status')
})

test('runRtkRewrite accepts rewritten output on non-zero exit (real rtk behavior)', async () => {
  const ctx = {
    shell: {
      resolve: (request) => request,
      async run(request) {
        assert.equal(request.command, "rtk rewrite 'git status'")
        return {
          exitCode: 3,
          stdout: { text: 'rtk git status', truncated: false },
          stderr: { text: '[rtk] No hook installed', truncated: false }
        }
      }
    }
  }

  const rewritten = await runRtkRewrite(ctx, 'git status')
  assert.equal(rewritten, 'rtk git status')
})

test('windowsCompatibilityMap refuses compound/pipelined commands', () => {
  assert.equal(windowsCompatibilityMap('ls -la | Select-Object -First 3'), null)
  assert.equal(windowsCompatibilityMap('dir; echo hi'), null)
  assert.equal(windowsCompatibilityMap('ls > out.txt'), null)
  assert.equal(windowsCompatibilityMap('git status && git log'), null)
  assert.equal(windowsCompatibilityMap('ls\nother'), null)
})

test('windowsCompatibilityMap refuses cat/type with PowerShell switches', () => {
  assert.equal(windowsCompatibilityMap('cat file.json -TotalCount 3'), null)
  assert.equal(windowsCompatibilityMap('type a.txt -Tail 5'), null)
  assert.equal(windowsCompatibilityMap('cat -Raw data.json'), null)
  // a dash inside a filename is not a switch
  assert.equal(windowsCompatibilityMap('cat file-name.txt'), 'rtk read file-name.txt')
  // a pipeline after cat stays native too
  assert.equal(windowsCompatibilityMap('cat a.txt | Select-Object -First 2'), null)
})

test('resolveRtkCommand keeps compound/flag commands native without calling rtk rewrite', async () => {
  let calls = 0
  const ctx = {
    shell: {
      resolve: (request) => request,
      async run() {
        calls++
        return {
          exitCode: 0,
          stdout: { text: 'rewritten', truncated: false },
          stderr: { text: '', truncated: false }
        }
      }
    }
  }

  const piped = await resolveRtkCommand(ctx, 'ls -la | Select-Object -First 3')
  assert.equal(piped, 'ls -la | Select-Object -First 3')
  const flagged = await resolveRtkCommand(ctx, 'cat file.json -TotalCount 3')
  assert.equal(flagged, 'cat file.json -TotalCount 3')
  assert.equal(calls, 0, 'rtk rewrite must not be invoked for fallback commands')
})

test('withRtkDbEnv probes primary path and falls back to TEMP', () => {
  const command = 'rtk git status'
  const wrapped = withRtkDbEnv(command)
  assert.match(wrapped, /^\$p='/)
  assert.match(wrapped, /storages\\rtk-history\.db'/)
  assert.match(wrapped, /OpenOrCreate/)
  assert.match(wrapped, /catch \{ \$p='[^']*rtk-history\.db' \}/)
  assert.match(wrapped, /\$env:RTK_DB_PATH=\$p/)
  assert.ok(wrapped.endsWith(`; ${command}`))
})

test('runRtkRewrite returns null when rtk rewrite emits no stdout and exits non-zero', async () => {
  const ctx = {
    shell: {
      resolve: (request) => request,
      async run() {
        return {
          exitCode: 1,
          stdout: { text: '', truncated: false },
          stderr: { text: '[rtk] No hook installed', truncated: false }
        }
      }
    }
  }

  const rewritten = await runRtkRewrite(ctx, 'not-a-real-command-xyz')
  assert.equal(rewritten, null)
})
