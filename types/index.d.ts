export type Mark = '✓' | '✘' | '-' | '~'

export type Problem = { mark: '✘' | '~'; title: string; duration: string; error: string; trace: string }

export type Followed = { path: string; taskId: string | null; command: string; startedAt: number; hasRetries: boolean }

export type RunCounts = {
  passed: number
  failed: number
  flaky: number
  skipped: number
  hasRetries: boolean
  command: string
  taskId: string | null
  remaining: number
  workers: number
  marks: Mark[]
  problems: Problem[]
  startedAt: number
  updatedAt: number
  isActive: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'runboard': { counts: RunCounts | null; frame: number; isDetailsOpen: boolean; following: Followed | null }
  }
}
