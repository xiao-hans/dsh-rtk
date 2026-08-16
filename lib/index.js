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
}
