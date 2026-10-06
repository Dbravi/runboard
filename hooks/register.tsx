import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register, Timer } from 'claude-code'

import type { Followed, Mark, Problem } from '../types'

const counts = atom({ plugin: 'runboard', key: 'counts' } as const, null)
const frame = atom({ plugin: 'runboard', key: 'frame' } as const, 0)
const isDetailsOpen = atom({ plugin: 'runboard', key: 'isDetailsOpen' } as const, false)
const following = atom({ plugin: 'runboard', key: 'following' } as const, null)

const TICK_MS = 2_000
const FRAME_MS = 150
const PULSE_FRAMES = 4
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const PLAYWRIGHT_GREEN = '#2EAD33'
const PLAYWRIGHT_RED = '#D65348'
const IDLE_MS = 600_000
const HIDE_MS = 240_000
const ROW_SQUARES = 50
const ETA_AFTER = 5

const RESULT_LINE = /^\s*([✓✘-])\s+\d+\s+(.+?)(?:\s+\(retry #\d+\))?(?:\s+\(([\d.]+(?:ms|s|m|h))\))?\s*$/
// "[chromium] › tests/a/b.spec.ts:39:13 › Describe › Test @tag" → "b.spec.ts:39" and "Describe › Test"
const TITLE_PARTS = /^\[[^\]]+\]\s+›\s+(?:\S*[\\/])?([^\\/\s]+):(\d+):\d+\s+›\s+(.*?)(?:\s+@\S+)*$/
// Colour and cursor codes Playwright writes when it thinks it has a terminal (seen on Windows).
const ANSI_CODES = /\x1b\[[0-9;?]*[A-Za-z]/g
const RUN_LINE = /Running (\d+) tests? using (\d+) workers?/
const SUMMARY_LINE = /^\s+\d+ (?:passed|failed|flaky|skipped|interrupted|did not run)\b/m
// What Claude Code appends to a background task's output file when the command ends or is stopped.
const TASK_END_LINE = /^\[(?:killed|exited with code \d+)\]$/m
const OUTPUT_PATH = /Output is being written to: (\S+\.output)/
const TASK_ID = /running in background with ID: (\S+?)\./
const CELL_COLOR = { '✓': 'green', '✘': 'red', '-': 'gray', '~': 'yellow', running: 'cyan' } as const

const FAILURE_HEADER = /^  \d+\) (.+?)\s*$/

// Playwright's end-of-run section per failed or flaky test; the last attempt (after "Retry #n") wins.
const failureDetails = (output: string) => {
  const details = new Map<string, { error: string; trace: string }>()
  let title: string | null = null
  let lines: string[] = []
  const flush = () => {
    if (title === null) return
    const attempt = lines.slice(lines.findLastIndex(line => /^\s+Retry #\d+/.test(line)) + 1)
    const find = (pattern: RegExp) => attempt.map(line => pattern.exec(line)?.[1]).find(Boolean)
    const expected = find(/^\s+Expected: (.*)$/)
    const received = find(/^\s+Received: (.*)$/)
    details.set(title, {
      error: [find(/^\s+Error: (.*)$/), expected && `Expected: ${expected}`, received && `Received: ${received}`]
        .filter(Boolean)
        .join(' · '),
      trace: attempt.map(line => /^\s+(\S*trace\.zip)$/.exec(line)?.[1]).findLast(Boolean) ?? '',
    })
  }
  for (const line of output.split('\n')) {
    const header = FAILURE_HEADER.exec(line)
    if (header?.[1] !== undefined) {
      flush()
      title = header[1]
      lines = []
    } else if (title !== null) {
      lines.push(line)
    }
  }
  flush()

  return details
}

const tally = (output: string) => {
  // Keyed by title, so a retry replaces the attempt before it; a pass after a failure is flaky.
  const marks = new Map<string, Mark>()
  const durations = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = RESULT_LINE.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      const before = marks.get(match[2])
      const isFlaky = match[1] === '✓' && (before === '✘' || before === '~')
      marks.set(match[2], isFlaky ? '~' : (match[1] as Mark))
      durations.set(match[2], match[3] ?? '')
    }
  }

  const all = [...marks.values()]
  const started = RUN_LINE.exec(output)
  const total = Number(started?.[1] ?? all.length)
  const details = failureDetails(output)

  return {
    passed: all.filter(mark => mark === '✓').length,
    failed: all.filter(mark => mark === '✘').length,
    flaky: all.filter(mark => mark === '~').length,
    skipped: all.filter(mark => mark === '-').length,
    remaining: Math.max(0, total - all.length),
    workers: Number(started?.[2] ?? 0),
    marks: all,
    problems: [...marks].flatMap(([title, mark]): Problem[] =>
      mark === '✘' || mark === '~'
        ? [{ mark, title, duration: durations.get(title) ?? '', error: '', trace: '', ...details.get(title) }]
        : [],
    ),
    isDone: SUMMARY_LINE.test(output) || TASK_END_LINE.test(output),
  }
}

const asDuration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)

  return minutes === 0
    ? `${total}s`
    : `${minutes}m${String(total % 60).padStart(2, '0')}s`
}

const RUNS_TESTS = /\bplaywright\s+test\b/
const NOT_A_RUN = /--(?:list|ui)\b/
const NPM_SCRIPT = /\bnpm\s+(?:run(?:-script)?\s+(\S+)|(test)\b)/

// `npm run <script>` counts when that package.json script runs `playwright test`; `--list` and `--ui` never do.
const isPlaywrightRun = async ($: EngineInterface, command: string) => {
  if (NOT_A_RUN.test(command)) return false
  if (RUNS_TESTS.test(command)) return true
  const script = NPM_SCRIPT.exec(command)
  if (script === null) return false
  const scripts: Record<string, string> = await $.fs
    .read('package.json')
    .then(text => JSON.parse(text).scripts ?? {})
    .catch(() => ({}))
  const body = scripts[script[1] ?? script[2] ?? ''] ?? ''

  return RUNS_TESTS.test(body) && !NOT_A_RUN.test(body)
}


const HTML_OUTPUT_FOLDER = /['"]html['"]\s*,\s*\{[^}]*?outputFolder:\s*['"]([^'"]+)['"]/

// show-report ignores the config, so pass the html reporter's outputFolder when the config sets one.
const reportFolder = async ($: EngineInterface) => {
  for (const config of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs']) {
    const folder = await $.fs
      .read(config)
      .then(text => HTML_OUTPUT_FOLDER.exec(text)?.[1])
      .catch(() => undefined)
    if (folder !== undefined) return [folder]
  }

  return []
}

let report: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | null = null

const openReport = async ($: EngineInterface) => {
  const folder = await reportFolder($)
  // show-report serves until killed, so a second press restarts it to reopen the browser.
  void report?.return(undefined as never)
  const child = $.process.spawn({ argv: ['npx', 'playwright', 'show-report', ...folder] })
  report = child
  for await (const chunk of child) void chunk
}

let timer: Timer | null = null
let hideTimer: Timer | null = null
let frameTimer: Timer | null = null
let runs = 0

// Owns the timers of the one run on screen; a later call (a new run, or a reload resuming) replaces it.
const track = ($: EngineInterface, followed: Followed) => {
  timer?.cancel()
  timer = null
  hideTimer?.cancel()
  hideTimer = null
  frameTimer?.cancel()
  frameTimer = $.clock.every(FRAME_MS, () => void update($, frame, tick => tick + 1))
  runs += 1
  const run = runs
  let changedAt = followed.startedAt
  let seen = ''

  const show = async (output: string, isFinal = false) => {
    if (run !== runs) {
      return false
    }

    const now = await $.clock.now()
    const { isDone, ...tallied } = tally(output.replace(ANSI_CODES, ''))
    if (output !== seen) {
      seen = output
      changedAt = now
    }

    const isActive = !isFinal && !isDone && now - changedAt < IDLE_MS
    await update($, counts, () => ({
      ...tallied,
      hasRetries: followed.hasRetries,
      command: followed.command,
      taskId: followed.taskId,
      startedAt: followed.startedAt,
      updatedAt: now,
      isActive,
    }))

    return isActive
  }

  const finish = () => {
    if (run !== runs) {
      return
    }

    timer?.cancel()
    timer = null
    frameTimer?.cancel()
    frameTimer = null
    void update($, following, () => null)
    hideTimer = $.clock.after(HIDE_MS, () => void update($, counts, () => null))
  }

  const poll = (path: string) => {
    timer = $.clock.every(TICK_MS, () => {
      void $.fs
        .read(path)
        .then(output => show(output))
        .then(isActive => {
          if (!isActive) {
            finish()
          }
        }, finish)
    })
  }

  return { show, finish, poll }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resumed = await read($, following)
    if (resumed === null) {
      await update($, counts, () => null)
    } else {
      track($, resumed).poll(resumed.path)
    }
    await update($, isDetailsOpen, () => false)

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await isPlaywrightRun($, e.command))) {
      return next(e)
    }

    await update($, isDetailsOpen, () => false)
    await update($, following, () => null)
    const followed: Followed = {
      path: '',
      taskId: null,
      command: e.command,
      startedAt: await $.clock.now(),
      hasRetries: Number(/--retries[= ](\d+)/.exec(e.command)?.[1] ?? 0) > 0,
    }
    const tracker = track($, followed)

    await tracker.show('')
    const ran = await next(e)
    const path = OUTPUT_PATH.exec(ran.text ?? '')?.[1]
    followed.taskId = TASK_ID.exec(ran.text ?? '')?.[1] ?? null

    if (path === undefined) {
      await tracker.show(ran.text ?? '', true)
      tracker.finish()

      return ran
    }

    followed.path = path
    await update($, following, () => ({ ...followed }))
    tracker.poll(path)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const run = await read($, counts)

    if (e.props.hasSurvey || run === null) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const tick = await read($, frame)
    const isDim = Math.floor(tick / PULSE_FRAMES) % 2 === 1
    const isOpen = await read($, isDetailsOpen)
    const took = asDuration(run.updatedAt - run.startedAt)
    const total = run.marks.length + run.remaining
    const done = run.marks.length
    const eta =
      run.isActive && done >= ETA_AFTER && run.remaining > 0
        ? ((run.updatedAt - run.startedAt) / done) * run.remaining
        : null
    const percent = total === 0 ? 0 : Math.floor((run.marks.length / total) * 100)
    // Playwright only reports finished tests, so the next `workers` slots stand in for the ones in flight.
    const running = run.isActive ? Math.min(run.workers, run.remaining) : 0
    const cells: (Mark | 'running' | undefined)[] = [
      ...run.marks,
      ...Array<'running'>(running).fill('running'),
      ...Array<undefined>(run.remaining - running).fill(undefined),
    ]
    const rows = Array.from({ length: Math.ceil(cells.length / ROW_SQUARES) }, (_, row) =>
      cells.slice(row * ROW_SQUARES, (row + 1) * ROW_SQUARES),
    )

    return (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          $ {run.command}
        </Text>
        <Box>
          {run.isActive && (
            <Text color={isDim ? PLAYWRIGHT_RED : PLAYWRIGHT_GREEN}>{SPINNER.charAt(tick % SPINNER.length)} </Text>
          )}
          <Text color={PLAYWRIGHT_RED}>Run</Text>
          <Text color={PLAYWRIGHT_GREEN}>board</Text>
          <Text dimColor>{run.isActive ? ' ' : ' (done) '}</Text>
          <Text bold>{percent}%</Text>
          <Text dimColor> · </Text>
          <Text color="green">{run.passed} passed</Text>
          <Text dimColor> · </Text>
          <Text color={run.failed > 0 ? 'red' : undefined} dimColor={run.failed === 0}>
            {run.failed} failed
          </Text>
          {(run.hasRetries || run.flaky > 0) && (
            <Text color={run.flaky > 0 ? 'yellow' : undefined} dimColor={run.flaky === 0}>
              {' '}
              · {run.flaky} flaky
            </Text>
          )}
          {run.skipped > 0 && <Text color="gray"> · {run.skipped} skipped</Text>}
          {total > 0 && (
            <Text dimColor>
              {' '}
              · {run.marks.length}/{total}
            </Text>
          )}
          <Text dimColor> · {took}</Text>
          {eta !== null && <Text dimColor> · ~{asDuration(eta)} left</Text>}
          <Text> </Text>
          {run.isActive && run.taskId !== null && (
            <Box key="stop-area">
              <Text>[ </Text>
              <Text color="red">● </Text>
              <Button
                key="stop"
                label="Stop run"
                plain
                hover={{ color: 'white', backgroundColor: '#8B0000' }}
                onPress={() => void $.tool.call({ tool: 'TaskStop', task_id: run.taskId ?? undefined })}
              />
              <Text> ]</Text>
            </Box>
          )}
          {!run.isActive && done > 0 && (
            <Box>
              <Text>[ </Text>
              <Text color="green">● </Text>
              <Button
                key="report"
                label="Open report"
                plain
                onPress={() =>
                  void openReport($).catch(error => $.ui.toast(`show-report failed: ${String(error)}`))
                }
              />
              <Text> ]</Text>
            </Box>
          )}
        </Box>
        <Box flexDirection="column">
          {rows.map(row => (
            <Text>
              {row.map(mark => (
                <Text
                  color={mark === undefined ? 'gray' : CELL_COLOR[mark]}
                  dimColor={mark === undefined || (mark === 'running' && isDim)}
                >
                  {mark === '-' ? '□' : '■'}{' '}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
        {run.problems.length > 0 && (
          <Button
            key="details"
            label={isOpen ? 'Hide details' : 'Details'}
            onPress={() => void update($, isDetailsOpen, open => !open)}
          />
        )}
        {isOpen &&
          run.problems.map((problem, index) => {
            const parts = TITLE_PARTS.exec(problem.title)
            const where = parts ? `${parts[1]}:${parts[2]}` : ''
            const name = parts?.[3] ?? problem.title

            return (
              <Box flexDirection="column">
                <Box>
                  <Text color={problem.mark === '✘' ? 'red' : 'yellow'} wrap="truncate-end">
                    {problem.mark} {where}  {name}  {problem.duration}
                    {problem.mark === '~' ? ' (passed on retry)' : ''}{' '}
                  </Text>
                  {problem.trace !== '' && (
                    <Button
                      key={`trace-${index}`}
                      label="Trace"
                      onPress={() => {
                        const child = $.process.spawn({ argv: ['npx', 'playwright', 'show-trace', problem.trace] })
                        void (async () => {
                          for await (const chunk of child) void chunk
                        })().catch(error => $.ui.toast(`show-trace failed: ${String(error)}`))
                      }}
                    />
                  )}
                </Box>
                {problem.error !== '' && (
                  <Text dimColor wrap="truncate-end">
                    {'  '}
                    {problem.error}
                  </Text>
                )}
              </Box>
            )
          })}
      </Box>
    )
  })
}
