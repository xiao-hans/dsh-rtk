import { isAbsolute, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { windowsCompatibilityMap, withRtkDbEnv } from './rewrite.js'
import { canonicalResult, renderForeground } from './pwsh-tool.js'

function resolveWorkdir(modelWorkdir, exec) {
  const headerCwd = exec.agent?.session.header.cwd
  if (modelWorkdir === undefined) return headerCwd
  if (headerCwd !== undefined && !isAbsolute(modelWorkdir)) return resolve(headerCwd, modelWorkdir)
  return modelWorkdir
}

function validateArgs(args) {
  if (typeof args.command !== 'string' || args.command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (typeof args.description !== 'string' || args.description.trim().length === 0) {
    throw new Error('invalid description: expected a non-empty string')
  }
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`)
  }
}

/**
 * Register the dedicated `rtk` tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerRtkTool(ctx) {
  ctx.tools.register(defineTool({
    name: 'rtk',
    description: 'Run a command through RTK (Rust Token Killer) to reduce token usage. Pass the command without the `rtk` prefix, e.g. "git status".',
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The command to run through RTK, e.g. "git status", "find . -maxdepth 2", "read src/main.rs".'
      },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI).'
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.'
      },
      workdir: {
        type: 'string',
        description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.'
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          kind: { type: 'string', required: true, const: 'foreground' },
          exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean', required: true },
          aborted: { type: 'boolean', required: true },
          timeoutMs: { type: 'number', required: true },
          stdout: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
              spillPath: { type: 'string' }
            }
          },
          stderr: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
              spillPath: { type: 'string' }
            }
          },
          sandbox: {
            type: 'object',
            additionalProperties: false,
            properties: {
              mode: { type: 'string', required: true },
              denied: { type: 'boolean', required: true },
              enforcement: { type: 'string' },
              runnerFailed: { type: 'boolean' }
            }
          }
        }
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderForeground(value)
      }]
    },
    async execute(args, exec) {
      validateArgs(args)

      const workdir = resolveWorkdir(args.workdir, exec)
      const dshEnv = ctx.shellEnv?.collect(exec) ?? {}

      const mapped = windowsCompatibilityMap(args.command)
      const rtkCommand = /^rtk\s+/i.test(mapped) ? mapped : `rtk ${mapped}`
      const command = withRtkDbEnv(rtkCommand)

      const request = {
        command,
        ...(workdir !== undefined ? { workdir } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        dshEnv,
        signal: exec.signal
      }

      const result = await ctx.shell.run(ctx.shell.resolve(request))
      return canonicalResult(result)
    }
  }))
}
