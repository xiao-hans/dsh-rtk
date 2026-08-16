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

  registerRtkTool(ctx)
  registerPwshTool(ctx)

  // The stock `pwsh` tool is re-registered by agent presets in the agent
  // scope, which shadows the global registration above. Register our RTK-aware
  // `pwsh` on each agent's own context so it shadows the stock tool for that
  // agent without modifying any preset files.
  ctx.on('agent/created', ({ agent }) => {
    if (agent?.ctx) {
      registerPwshTool(agent.ctx)
    }
  })
}
