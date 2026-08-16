import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * PowerShell-only syntax that a whole-line `rtk ...` rewrite must never
 * swallow: pipelines, statement separators, redirections, and line breaks all
 * carry meaning at the PowerShell layer and would be silently dropped.
 */
const COMPOUND_COMMAND = /[\r\n|;&><]/

/**
 * True when a token looks like a PowerShell parameter switch (`-TotalCount`).
 * A `-` inside a filename (`file-name.txt`) is not a switch.
 */
function hasPowerShellFlag(text) {
  return /(?:^|\s)-[A-Za-z]/.test(text)
}

/**
 * Map Windows/PowerShell-unfriendly commands to RTK commands that work on
 * Windows. This is a best-effort compatibility layer: when in doubt we keep
 * the original command so the plugin never blocks execution.
 *
 * @param {string} command
 * @returns {string | null} the mapped command, or `null` when the command
 *   must be executed verbatim without any RTK rewrite attempt (compound
 *   pipelines, or cat/type with PowerShell-only switches).
 */
export function windowsCompatibilityMap(command) {
  const trimmed = command.trim()

  // Never rewrite compound/pipelined commands: `ls -la | Select-Object -First 3`
  // must keep its pipeline, not become a single `rtk find . -maxdepth 1`.
  if (COMPOUND_COMMAND.test(trimmed)) return null

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

  // `cat` / `type` → `rtk read`, but never when PowerShell-specific switches
  // are present (`-TotalCount`, `-Tail`, `-Raw`, ...): rtk read does not
  // understand them, so fall back to the native PowerShell aliases.
  m = trimmed.match(/^(cat|type)(?:\s+(.*))?$/i)
  if (m) {
    const rest = (m[2] ?? '').trim()
    if (rest && !hasPowerShellFlag(rest)) return `rtk read ${rest}`
    return null
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

  // rtk cat → rtk read (defensive; rtk rewrite normally emits rtk read), but
  // never when PowerShell-only switches ride along.
  m = trimmed.match(/^rtk\s+cat(?:\s+(.*))?$/i)
  if (m) {
    const rest = (m[1] ?? '').trim()
    if (rest && !hasPowerShellFlag(rest)) return `rtk read ${rest}`
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
 * The primary path (`$DSH_HOME/storages`) may itself be outside the command
 * sandbox's writable set. Probe writability at command time in PowerShell and
 * silently fall back to `$env:TEMP` when denied, so tracking keeps working
 * inside the sandbox.
 *
 * @param {string} command
 * @returns {string}
 */
export function withRtkDbEnv(command) {
  const primary = rtkDbPath().replace(/'/g, "''")
  const fallback = join(tmpdir(), 'rtk-history.db').replace(/'/g, "''")
  const probe =
    `$p='${primary}'; ` +
    "try { [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p)) | Out-Null; ([IO.File]::Open($p, 'OpenOrCreate')).Close() } " +
    `catch { $p='${fallback}' }; ` +
    '$env:RTK_DB_PATH=$p'
  return `${probe}; ${command}`
}

/**
 * Run `rtk rewrite` and return the rewritten command, or `null` when there is
 * no rewrite / RTK is unavailable / the call fails.
 *
 * @param {{ shell?: object, subprocess?: object }} rt - resolved runtime services.
 * @param {string} command
 * @param {{ workdir?: string, signal?: AbortSignal, dshEnv?: Record<string, string> }} [options]
 * @returns {Promise<string | null>}
 */
export async function runRtkRewrite(rt, command, options = {}) {
  const { workdir, signal, dshEnv = {} } = options
  const subprocess = rt.subprocess

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

  const shell = rt.shell
  if (shell?.run) {
    const result = await shell.run(shell.resolve({
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
 * @param {{ shell?: object, subprocess?: object }} rt - resolved runtime services.
 * @param {string} command
 * @param {{ workdir?: string, signal?: AbortSignal, dshEnv?: Record<string, string> }} [options]
 * @returns {Promise<string>}
 */
export async function resolveRtkCommand(rt, command, options = {}) {
  const trimmed = command.trim()
  if (/^rtk\s+/i.test(trimmed)) return trimmed

  const mapped = windowsCompatibilityMap(trimmed)
  // The compatibility layer says: keep this command verbatim — do not even ask
  // `rtk rewrite` (it would break the pipeline or PowerShell-only switches).
  if (mapped === null) return trimmed
  if (/^rtk\s+/i.test(mapped)) return mapped

  const rewritten = await runRtkRewrite(rt, mapped, options)
  if (rewritten) {
    const processed = postProcessRewritten(rewritten)
    if (processed !== null) return processed
  }

  return trimmed
}
