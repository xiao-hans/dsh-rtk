import { isAbsolute, resolve } from 'node:path'
import { resolveRtkCommand, withRtkDbEnv } from './rewrite.js'

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

function resolveWorkdir(modelWorkdir, exec) {
  const headerCwd = exec.agent?.session.header.cwd
  if (modelWorkdir === undefined) return headerCwd
  if (headerCwd !== undefined && !isAbsolute(modelWorkdir)) return resolve(headerCwd, modelWorkdir)
  return modelWorkdir
}

function streamText(stream) {
  if (!stream?.truncated) return stream?.text ?? ''
  return `${stream.text ?? ''}\n[output truncated; full output: ${stream.spillPath ?? '(unavailable)'}]`
}

export function renderForeground(result) {
  const out = streamText(result.stdout)
  const err = streamText(result.stderr)
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'

  const markers = []
  if (result.sandbox?.denied) {
    markers.push(`[sandbox: file access denied under ${result.sandbox.mode} mode]`)
  }
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`)
  else if (result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`)

  if (markers.length > 0) {
    if (!body.endsWith('\n')) body += '\n'
    body += markers.join('\n')
  }
  return body
}

export function canonicalResult(result) {
  const output = (stream) => ({
    text: stream?.text ?? '',
    truncated: stream?.truncated ?? false,
    ...(stream?.spillPath !== undefined ? { spillPath: stream.spillPath } : {})
  })

  return {
    kind: 'foreground',
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...(result.sandbox !== undefined ? { sandbox: result.sandbox } : {})
  }
}

/**
 * Register the RTK-aware `pwsh` tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - context to register on.
 * @param {{ shell: object, shellEnv: object, subprocess?: object }} services
 *   Runtime services captured once from the apply context, so the execute
 *   closure never has to resolve services from a possibly-unscoped agent ctx.
 */
export function registerPwshTool(ctx, services) {
  const { shell, shellEnv, subprocess } = services
  ctx.tools.register({
    name: 'pwsh',
    description: 'Execute a PowerShell command. Common commands are automatically rewritten through RTK to reduce token usage. Each call runs in a fresh pwsh process: no state persists between calls — pass `workdir` instead of using `cd`.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The PowerShell command to execute.'
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

      const resolved = await resolveRtkCommand({ shell, subprocess }, args.command, {
        workdir,
        signal: exec.signal,
        dshEnv
      })

      const command = withRtkDbEnv(resolved)
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
