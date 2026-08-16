import { registerPwshTool } from './pwsh-tool.js'
import { registerRtkTool } from './rtk-tool.js'

export const name = 'dsh-rtk'

export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']

/**
 * DSH RTK thin adapter.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'tool:rtk',
    order: 106,
    text: 'Prefer RTK for common shell commands to reduce token usage. The `pwsh` tool automatically rewrites supported commands through RTK, and a dedicated `rtk` tool is available. Examples: `rtk git status`, `rtk git log`, `rtk find`, `rtk read`, `rtk grep`, `rtk cargo test`, `rtk pytest`.'
  })

  // Resolve the runtime services ONCE, here in the apply fiber where `inject`
  // holds. The tool execute closures use these captured instances directly, so
  // per-agent re-registration never has to resolve services from the agent ctx.
  const services = {
    shell: ctx.shell,
    shellEnv: ctx.shellEnv,
    subprocess: ctx.get?.('subprocess')
  }

  registerRtkTool(ctx, services)
  registerPwshTool(ctx, services)

  // The stock `pwsh` tool is re-registered by agent presets in the agent
  // scope (as an ancestor of the agent's own scope), which shadows the global
  // registration above. Register our RTK-aware `pwsh` on each agent's own
  // scope so it shadows the stock tool for that agent — nearest scope wins —
  // without modifying any preset files. Only `pwsh` needs this: `rtk` is a
  // unique name no preset competes with, so its global registration survives.
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.ctx) {
      registerPwshTool(agent.ctx, services)
    }
  })
}
