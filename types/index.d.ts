// `!` is a test the run was stopped in the middle of: Playwright marks it ✘ like a failure, and only
// its summary tells the two apart.
export type Mark = '✓' | '✘' | '-' | '~' | '!'

export type Problem = { mark: '✘' | '~' | '!'; title: string; duration: string; error: string; trace: string }

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
  interrupted: number
  // The run ended before every test ran: Stop, --max-failures, a global timeout, a killed task.
  isStopped: boolean
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
  // Set once the run has ended and its html report is written.
  hasReport?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'runboard': { counts: RunCounts | null; frame: number; isDetailsOpen: boolean; following: Followed | null }
  }
}
