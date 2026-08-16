import { isAbsolute, resolve } from 'node:path'
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
 * @param {import('@deepseek-ai/cordis').Context} ctx - context to register on.
 * @param {{ shell: object, shellEnv: object, subprocess?: object }} services
 *   Runtime services captured once from the apply context, so the execute
 *   closure never has to resolve services from a possibly-unscoped agent ctx.
 */
export function registerRtkTool(ctx, services) {
  const { shell, shellEnv } = services
  ctx.tools.register({
    name: 'rtk',
    description: 'Run a command through RTK (Rust Token Killer) to reduce token usage. Pass the command without the `rtk` prefix, e.g. "git status".',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to run through RTK, e.g. "git status", "find . -maxdepth 2", "read src/main.rs".'
        },
        description: {
          type: 'string',
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
      required: ['command', 'description']
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'exitCode', 'signal', 'timedOut', 'aborted', 'timeoutMs', 'stdout', 'stderr'],
        properties: {
          kind: { type: 'string', const: 'foreground' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean' },
          aborted: { type: 'boolean' },
          timeoutMs: { type: 'number' },
          stdout: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'truncated'],
            properties: {
              text: { type: 'string' },
              truncated: { type: 'boolean' },
              spillPath: { type: 'string' }
            }
          },
          stderr: {
            type: 'object',
            additionalProperties: false,
            required: ['text', 'truncated'],
            properties: {
              text: { type: 'string' },
              truncated: { type: 'boolean' },
              spillPath: { type: 'string' }
            }
          },
          sandbox: {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'denied'],
            properties: {
              mode: { type: 'string' },
              denied: { type: 'boolean' },
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
      const dshEnv = shellEnv?.collect(exec) ?? {}

      const mapped = windowsCompatibilityMap(args.command)
      // null means the map declined to rewrite (compound pipeline / PowerShell
      // switches): the explicit rtk tool still routes the ORIGINAL command
      // through RTK (a pipe splits at the PowerShell layer, so `rtk ls -la |
      // Select-Object ...` still works), rather than emitting `rtk null`.
      const base = mapped === null ? args.command.trim() : mapped
      const rtkCommand = /^rtk\s+/i.test(base) ? base : `rtk ${base}`
      const command = withRtkDbEnv(rtkCommand)

      const request = {
        command,
        ...(workdir !== undefined ? { workdir } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        dshEnv,
        signal: exec.signal
      }

      const result = await shell.run(shell.resolve(request))
      return canonicalResult(result)
    }
  })
}
