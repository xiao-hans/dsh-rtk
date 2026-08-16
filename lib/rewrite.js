import { join } from 'node:path'

/**
 * Map Windows/PowerShell-unfriendly commands to RTK commands that work on
 * Windows. This is a best-effort compatibility layer: when in doubt we keep
 * the original command so the plugin never blocks execution.
 *
 * @param {string} command
 * @returns {string}
 */
export function windowsCompatibilityMap(command) {
  const trimmed = command.trim()

  // `ls` / `dir` → `rtk find` (native `ls` does not exist in Windows PowerShell)
  let m = trimmed.match(/^(ls|dir)(?:\s+(.*))?$/i)
  if (m) {
    const rest = (m[2] ?? '').trim()
    if (rest === '' || !rest.startsWith('-')) {
      const path = rest === '' ? '.' : rest
      return `rtk find ${path} -maxdepth 1`
    }
    // Keep it working even with flags; `rtk find` is the Windows-safe listing path.
    return 'rtk find . -maxdepth 1'
  }

  // `cat` / `type` → `rtk read`
  m = trimmed.match(/^(cat|type)(?:\s+(.*))?$/i)
  if (m) {
    const rest = (m[2] ?? '').trim()
    if (rest) return `rtk read ${rest}`
    return trimmed
  }

  return trimmed
}

/**
 * Post-process a command produced by `rtk rewrite`. Returns `null` when the
 * rewritten command is known to be broken on Windows and should not be used.
 *
 * @param {string} rewritten
 * @returns {string | null}
 */
export function postProcessRewritten(rewritten) {
  const trimmed = rewritten.trim()

  // rtk ls → rtk find (Windows has no native `ls` for rtk to proxy)
  let m = trimmed.match(/^rtk\s+ls(?:\s+(.*))?$/i)
  if (m) {
    const rest = (m[1] ?? '').trim()
    if (rest === '' || !rest.startsWith('-')) {
      const path = rest === '' ? '.' : rest
      return `rtk find ${path} -maxdepth 1`
    }
    return null
  }

  // rtk cat → rtk read (defensive; rtk rewrite normally emits rtk read)
  m = trimmed.match(/^rtk\s+cat(?:\s+(.*))?$/i)
  if (m) {
    const rest = (m[1] ?? '').trim()
    if (rest) return `rtk read ${rest}`
    return null
  }

  return trimmed
}

/**
 * Default DSH home directory. Used to place the redirected RTK history DB.
 *
 * @returns {string}
 */
export function dshHome() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
}

/**
 * RTK history database path redirected into DSH-writable storage.
 *
 * @returns {string}
 */
export function rtkDbPath() {
  return join(dshHome(), 'storages', 'rtk-history.db')
}

/**
 * Quote a single argument for PowerShell command strings.
 *
 * @param {string} arg
 * @returns {string}
 */
export function quotePowerShellArg(arg) {
  return `'${String(arg).replace(/'/g, "''")}'`
}

/**
 * Prefix a PowerShell command with `RTK_DB_PATH` so RTK writes its history DB
 * inside DSH storage instead of the sandbox-denied AppData location.
 *
 * @param {string} command
 * @returns {string}
 */
export function withRtkDbEnv(command) {
  const db = rtkDbPath().replace(/'/g, "''")
  return `$env:RTK_DB_PATH='${db}'; ${command}`
}

/**
 * Run `rtk rewrite` and return the rewritten command, or `null` when there is
 * no rewrite / RTK is unavailable / the call fails.
 *
 * @param {object} ctx
 * @param {string} command
 * @param {{ workdir?: string, signal?: AbortSignal, dshEnv?: Record<string, string> }} [options]
 * @returns {Promise<string | null>}
 */
export async function runRtkRewrite(ctx, command, options = {}) {
  const { workdir, signal, dshEnv = {} } = options
  const subprocess = ctx.get?.('subprocess')

  if (subprocess?.spawn) {
    const handle = subprocess.spawn({
      argv: ['rtk', 'rewrite', command],
      cwd: workdir || process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 64 * 1024, spill: { maxBytes: 1024 * 1024 } },
        stderr: { maxBytes: 64 * 1024, spill: { maxBytes: 1024 * 1024 } }
      },
      graceMs: 2000,
      ...(signal ? { signal } : {}),
      env: { ...dshEnv }
    })

    await handle.done
    const text = handle.collected.stdout?.readFrom(0).text.trim() ?? ''
    return text || null
  }

  if (ctx.shell?.run) {
    const result = await ctx.shell.run(ctx.shell.resolve({
      command: `rtk rewrite ${quotePowerShellArg(command)}`,
      ...(workdir ? { workdir } : {}),
      dshEnv,
      ...(signal ? { signal } : {})
    }))

    // RTK may exit non-zero (e.g. 3 when no shell hook is installed) while
    // still emitting the rewritten command on stdout. Treat a non-empty stdout
    // as a successful rewrite; only return null when there is no output.
    const text = result.stdout?.text?.trim() ?? ''
    return text || null
  }

  return null
}

/**
 * Resolve the final command to execute:
 * 1. Already `rtk ...` → keep as-is.
 * 2. Windows compatibility map produces `rtk ...` → use it directly.
 * 3. Otherwise ask `rtk rewrite`; fall back to the original on failure.
 *
 * @param {object} ctx
 * @param {string} command
 * @param {{ workdir?: string, signal?: AbortSignal, dshEnv?: Record<string, string> }} [options]
 * @returns {Promise<string>}
 */
export async function resolveRtkCommand(ctx, command, options = {}) {
  const trimmed = command.trim()
  if (/^rtk\s+/i.test(trimmed)) return trimmed

  const mapped = windowsCompatibilityMap(trimmed)
  if (/^rtk\s+/i.test(mapped)) return mapped

  const rewritten = await runRtkRewrite(ctx, mapped, options)
  if (rewritten) {
    const processed = postProcessRewritten(rewritten)
    if (processed !== null) return processed
  }

  return trimmed
}
