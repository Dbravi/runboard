export type Mark = '✓' | '✘' | '-' | '~'

export type Problem = { mark: '✘' | '~'; title: string; duration: string; error: string; trace: string }

// `cwd` is the folder the run ran in, absolute; absent on a run followed before it was recorded.
export type Followed = {
  path: string
  taskId: string | null
  command: string
  cwd?: string
  startedAt: number
  hasRetries: boolean
}

export type RunCounts = {
  passed: number
  failed: number
  flaky: number
  skipped: number
  needsListReporter: boolean
  hasRetries: boolean
  command: string
  cwd?: string
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
