import test from 'node:test'
import assert from 'node:assert/strict'
import {
  windowsCompatibilityMap,
  postProcessRewritten,
  resolveRtkCommand
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
