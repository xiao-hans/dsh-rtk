import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

function makeCtx() {
  const registered = []
  const prompts = []
  const shellCalls = []

  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {}
      }
    },
    systemPrompt: {
      section(section) {
        prompts.push(section)
      }
    },
    shellEnv: {
      collect() {
        return { DSH_SESSION_ID: 'test-session' }
      }
    },
    shell: {
      resolve: (request) => request,
      async run(request) {
        shellCalls.push(request)
        if (request.command.startsWith("rtk rewrite 'git status'")) {
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            aborted: false,
            timeoutMs: 0,
            stdout: { text: 'rtk git status', truncated: false },
            stderr: { text: '', truncated: false }
          }
        }
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 0,
          stdout: { text: 'filtered output', truncated: false },
          stderr: { text: '', truncated: false }
        }
      }
    },
    get(key) {
      if (key === 'subprocess') return undefined
      return undefined
    }
  }

  return { ctx, registered, prompts, shellCalls }
}

function fakeExec() {
  return {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: process.cwd() } } }
  }
}

test('plugin registers pwsh and rtk tools plus system prompt', () => {
  const { ctx, registered, prompts } = makeCtx()
  apply(ctx)

  const names = registered.map((tool) => tool.name)
  assert.ok(names.includes('pwsh'))
  assert.ok(names.includes('rtk'))
  assert.ok(prompts.some((p) => p.name === 'tool:rtk'))
})

test('pwsh tool auto-rewrites git status through rtk', async () => {
  const { ctx, registered, shellCalls } = makeCtx()
  apply(ctx)

  const pwsh = registered.find((tool) => tool.name === 'pwsh')
  const result = await pwsh.execute(
    { command: 'git status', description: 'Show git status' },
    fakeExec()
  )

  assert.equal(result.kind, 'foreground')
  assert.equal(result.stdout.text, 'filtered output')

  const rtkRewriteCall = shellCalls.find((c) => c.command.startsWith('rtk rewrite'))
  assert.ok(rtkRewriteCall, 'should call rtk rewrite first')
  assert.equal(rtkRewriteCall.command, "rtk rewrite 'git status'")

  const finalCall = shellCalls.at(-1)
  assert.match(finalCall.command, /^\$env:RTK_DB_PATH=/)
  assert.match(finalCall.command, /rtk git status$/)
})

test('rtk tool maps ls to rtk find with RTK_DB_PATH', async () => {
  const { ctx, registered, shellCalls } = makeCtx()
  apply(ctx)

  const rtk = registered.find((tool) => tool.name === 'rtk')
  const result = await rtk.execute(
    { command: 'ls', description: 'List files' },
    fakeExec()
  )

  assert.equal(result.kind, 'foreground')
  assert.equal(shellCalls.length, 1)
  assert.match(shellCalls[0].command, /^\$env:RTK_DB_PATH=/)
  assert.match(shellCalls[0].command, /rtk find \. -maxdepth 1$/)
})