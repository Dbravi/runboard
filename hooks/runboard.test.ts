import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'runboard',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const BACKGROUNDED = {
  result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
  text: 'Command running in background with ID: b1. Output is being written to: /tmp/tasks/b1.output. You will be notified when it completes.',
}

// The html report's index.html, written after the run started.
const FRESH_REPORT = { value: { kind: 'file', size: 1, mtimeMs: Number.MAX_SAFE_INTEGER, isLink: false } } as const

// Answers a stat of the report's index.html; no project CLI is there, so the buttons fall back to npx.
const statReport = (_: unknown, e: { path: string }) => {
  if (!e.path.endsWith('index.html')) throw new Error('ENOENT')

  return FRESH_REPORT
}

const MIDWAY = `Running 4 tests using 1 worker

  ✓  1 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (29.8s)
  ✘  2 [chromium] › tests/a.spec.ts:20:5 › A › WS02 - Explores @shop (1.1m)
`

const FINISHED = `${MIDWAY}  ✓  3 [chromium] › tests/a.spec.ts:20:5 › A › WS02 - Explores @shop (retry #1) (14.4s)
  ✓  4 [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop (15.5s)
  -  5 [chromium] › tests/a.spec.ts:40:5 › A › WS04 - Modifies @shop

  1 flaky
  2 passed (2.1m)
`

const text = async (ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<unknown> }, pattern: RegExp) =>
  ui.find({ type: 'Text', text: pattern })

test('a background run is counted live from its output file', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: MIDWAY }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await text(ui, /1 passed/)).toBeDefined()
    expect(await text(ui, /1 failed/)).toBeDefined()
    expect(await text(ui, /^\$ npx playwright test --project=chromium\s*$/)).toBeDefined()
    expect(await text(ui, / · 2\/4$/)).toBeDefined()
    expect(await text(ui, /^50%$/)).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^Run$/ }))?.props.color).toBe('#D65348')
    expect((await ui.find({ type: 'Text', text: /^board$/ }))?.props.color).toBe('#2EAD33')
    expect(await text(ui, /flaky/)).toBeUndefined()
    expect(await text(ui, /skipped/)).toBeUndefined()
    expect(await ui.find({ key: 'report' })).toBeUndefined()
    const cells = await ui.findAll({ type: 'Text', text: /^■ $/ })
    expect(cells.map(cell => (cell.props.color === 'gray' && cell.props.dimColor === true ? 'empty' : cell.props.color))).toEqual([
      'green',
      'red',
      'cyan',
      'empty',
    ])
    await ui.unmount()
  }
})

test('a passing retry turns its failed attempt flaky, and the band clears three minutes after the summary', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: FINISHED }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const done = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(done, /done/)).toBeDefined()
  expect(await text(done, /2 passed/)).toBeDefined()
  expect(await text(done, /0 failed/)).toBeDefined()
  expect(await text(done, /1 flaky/)).toBeDefined()
  expect(await text(done, /1 skipped/)).toBeDefined()
  expect(await text(done, /^100%$/)).toBeDefined()
  expect(await text(done, /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] $/)).toBeUndefined()
  const cells = await done.findAll({ type: 'Text', text: /^[■□] $/ })
  expect(cells.map(cell => `${cell.text.trim()} ${String(cell.props.color)}`)).toEqual([
    '■ green',
    '■ yellow',
    '■ green',
    '□ gray',
  ])
  expect(await text(done, / · 4\/4$/)).toBeDefined()
  await done.unmount()

  await clock.advance(180_000)

  const cleared = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(cleared, /passed/)).toBeUndefined()
  await cleared.unmount()
})

test('a foreground run is counted from its result once it returns', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: { stdout: FINISHED, stderr: '', interrupted: false }, text: FINISHED }))
  on('ui.render', () => ({ type: 'Box', children: [] }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /2 passed/)).toBeDefined()
  expect(await text(ui, /done/)).toBeDefined()
  await ui.unmount()
})

test('the band stays out of the way until a Playwright run starts', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: MIDWAY }))

  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /passed/)).toBeUndefined()
  await ui.unmount()
})

test('a test that fails every attempt stays failed', async ($, on) => {
  mock.clock(on)
  const output = `Running 1 test using 1 worker

  ✘  1 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (2.0s)
  ✘  2 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (retry #1) (2.0s)

  1 failed
`
  on('tool.call', () => ({ result: { stdout: output, stderr: '', interrupted: false }, text: output }))
  on('ui.render', () => ({ type: 'Box', children: [] }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /1 failed/)).toBeDefined()
  expect(await text(ui, /flaky/)).toBeUndefined()
  await ui.unmount()
})

test('a new run takes over from one still being polled, and a killed run ends as stopped', async ($, on) => {
  const clock = mock.clock(on)
  const second = {
    ...BACKGROUNDED,
    text: 'Command running in background with ID: b2. Output is being written to: /tmp/tasks/b2.output. You will be notified when it completes.',
  }
  let call = 0
  on('tool.call', () => (++call === 1 ? BACKGROUNDED : second))
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', ($, e) => ({
    value: e.path.endsWith('b1.output')
      ? MIDWAY
      : 'Running 2 tests using 1 worker\n\n  ✓  1 [chromium] › tests/b.spec.ts:1:1 › B › One (1.0s)\n\n[killed]\n',
  }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)
  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /^ \(stopped\) $/)).toBeDefined()
  expect(await text(ui, /done/)).toBeUndefined()
  expect(await text(ui, /1 passed/)).toBeDefined()
  expect(await text(ui, /0 failed/)).toBeDefined()
  expect(await text(ui, /1 not run/)).toBeDefined()
  expect(await text(ui, / · 1\/2$/)).toBeDefined()
  const cells = await ui.findAll({ type: 'Text', text: /^■ $/ })
  expect(cells.some(cell => cell.props.color === 'cyan')).toBe(false)
  await ui.unmount()
})

// A real run stopped mid-retry (--max-failures=1, Playwright 1.59), trimmed: the retry of "greeting"
// was interrupted, but its first attempt failed, so Playwright still counts it failed.
const STOPPED_IN_RETRY = `Running 10 tests using 2 workers

  ✓   2 [chromium] › tests/runboard-demo.spec.ts:20:5 › passing: heading is visible (954ms)
  ✓   1 [chromium] › tests/runboard-demo.spec.ts:25:5 › passing: input accepts text (1.3s)
  ✓   4 [chromium] › tests/runboard-demo.spec.ts:38:5 › passing: list has three items (1.1s)
  ✓   3 [chromium] › tests/runboard-demo.spec.ts:31:5 › passing: button greets the user (1.7s)
  ✓   6 [chromium] › tests/runboard-demo.spec.ts:48:5 › passing: output starts empty (804ms)
  ✓   5 [chromium] › tests/runboard-demo.spec.ts:43:5 › passing: placeholder is set (2.1s)
  ✘   7 [chromium] › tests/runboard-demo.spec.ts:53:5 › flaky: fails on first try, passes on retry (2.7s)
  ✘   8 [chromium] › tests/runboard-demo.spec.ts:59:5 › flaky: list count only right on retry (2.1s)
  ✓  10 [chromium] › tests/runboard-demo.spec.ts:59:5 › flaky: list count only right on retry (retry #1) (1.1s)
  ✓   9 [chromium] › tests/runboard-demo.spec.ts:53:5 › flaky: fails on first try, passes on retry (retry #1) (1.7s)
  ✘  12 [chromium] › tests/runboard-demo.spec.ts:72:5 › failing: missing element (2.0s)
  ✘  11 [chromium] › tests/runboard-demo.spec.ts:65:5 › failing: greeting has the wrong name (2.3s)
  ✘  13 [chromium] › tests/runboard-demo.spec.ts:72:5 › failing: missing element (retry #1) (2.1s)
Testing stopped early after 1 maximum allowed failures.
  ✘  14 [chromium] › tests/runboard-demo.spec.ts:65:5 › failing: greeting has the wrong name (retry #1) (1.9s)


  1) [chromium] › tests/runboard-demo.spec.ts:65:5 › failing: greeting has the wrong name ──────────

    Error: expect(locator).toHaveText(expected) failed

    Expected: "Hello Bob"
    Received: "Hello Alice"

    Retry #1 ───────────────────────────────────────────────────────────────────────────────────────

    Test was interrupted.

    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/runboard-demo-failing-greeting-has-the-wrong-name-chromium-retry1/trace.zip
    Usage:

        npx playwright show-trace test-results/runboard-demo-failing-greeting-has-the-wrong-name-chromium-retry1/trace.zip

  2 failed
    [chromium] › tests/runboard-demo.spec.ts:65:5 › failing: greeting has the wrong name ───────────
    [chromium] › tests/runboard-demo.spec.ts:72:5 › failing: missing element ───────────────────────
  2 flaky
    [chromium] › tests/runboard-demo.spec.ts:53:5 › flaky: fails on first try, passes on retry ─────
    [chromium] › tests/runboard-demo.spec.ts:59:5 › flaky: list count only right on retry ──────────
  6 passed (14.9s)
  1 error was not a part of any test, see above for details
`

// Stopped mid-run in Playwright's format (list.js prints an interrupted result with ✘; base.js lists it
// under "N interrupted"): one test cut off on its first attempt, two never started.
const STOPPED_MID_RUN = `Running 5 tests using 2 workers

  ✓  1 [chromium] › tests/a.spec.ts:10:5 › A › one (1.0s)
  ✘  2 [chromium] › tests/a.spec.ts:20:5 › A › two (2.0s)
  ✘  3 [chromium] › tests/a.spec.ts:30:5 › A › three (500ms)

  1) [chromium] › tests/a.spec.ts:20:5 › A › two ───────────────────────────────

    Error: expect(received).toBe(expected)

  1 failed
    [chromium] › tests/a.spec.ts:20:5 › A › two ────────────────────────────────
  1 interrupted
    [chromium] › tests/a.spec.ts:30:5 › A › three ──────────────────────────────
  2 did not run
  1 passed (3.0s)
`

const finishedBand = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  output: string,
) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: output }))
  on('fs.stat', statReport)

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  await clock.advance(2_000)

  return $.ui.mount({ ...BAND, surface: 'terminal' })
}

const squares = async (ui: Awaited<ReturnType<typeof finishedBand>>) =>
  (await ui.findAll({ type: 'Text', text: /^[■□] $/ })).map(cell =>
    cell.props.color === 'gray' && cell.props.dimColor === true ? 'empty' : cell.props.color,
  )

test('a run stopped mid-run keeps interrupted and never-started tests apart from failures', async ($, on) => {
  const ui = await finishedBand($, on, STOPPED_MID_RUN)
  expect(await text(ui, /^ \(stopped\) $/)).toBeDefined()
  expect(await text(ui, /done/)).toBeUndefined()
  expect(await text(ui, /^1 passed$/)).toBeDefined()
  expect(await text(ui, /^1 failed$/)).toBeDefined()
  expect(await text(ui, /^ · 1 interrupted$/)).toBeDefined()
  expect(await text(ui, /^ · 2 not run$/)).toBeDefined()
  // Two of five got a result: the interrupted one doesn't count as done.
  expect(await text(ui, / · 2\/5$/)).toBeDefined()
  expect(await text(ui, /^40%$/)).toBeDefined()
  expect(await squares(ui)).toEqual(['green', 'red', 'magenta', 'empty', 'empty'])

  await ui.press({ key: 'details' })
  expect(await text(ui, /^✘ a\.spec\.ts:20  A › two  2\.0s/)).toBeDefined()
  expect(await text(ui, /^⊘ a\.spec\.ts:30  A › three  500ms \(interrupted\)/)).toBeDefined()
  expect(await text(ui, /^  Test was interrupted\.$/)).toBeDefined()
  await ui.unmount()
})

test('a run stopped during a retry keeps the completed results and the failure behind the retry', async ($, on) => {
  const ui = await finishedBand($, on, STOPPED_IN_RETRY)
  expect(await text(ui, /^ \(stopped\) $/)).toBeDefined()
  expect(await text(ui, /^6 passed$/)).toBeDefined()
  expect(await text(ui, /^2 failed$/)).toBeDefined()
  expect(await text(ui, / · 2 flaky$/)).toBeDefined()
  expect(await text(ui, /interrupted/)).toBeUndefined()
  expect(await text(ui, /not run/)).toBeUndefined()
  expect(await text(ui, / · 10\/10$/)).toBeDefined()

  await ui.press({ key: 'details' })
  // The interrupted retry has no error of its own; the failed attempt before it explains the failure.
  expect(await text(ui, /^  expect\(locator\)\.toHaveText\(expected\) failed · Expected: "Hello Bob" · Received: "Hello Alice"$/)).toBeDefined()
  await ui.unmount()
})

test('a run that finished every test ends as done, not stopped', async ($, on) => {
  const ui = await finishedBand($, on, FINISHED)
  expect(await text(ui, /^ \(done\) $/)).toBeDefined()
  expect(await text(ui, /stopped/)).toBeUndefined()
  expect(await text(ui, /not run/)).toBeUndefined()
  await ui.unmount()
})

test('the squares wrap into rows of at most 50', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: 'Running 70 tests using 4 workers\n' }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const rows = await ui.findAll({ type: 'Text', text: /^(■ ){2,}$/ })
  expect(rows.map(row => row.text.length / 2)).toEqual([50, 20])
  await ui.unmount()
})

test('a run with retries shows the flaky count from the start', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: 'Running 100 tests using 4 workers\n' }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium --retries=1' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /0 flaky/)).toBeDefined()
  expect(await text(ui, / · 0\/100$/)).toBeDefined()
  await ui.unmount()
})

test('the running squares blink while the run is active', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: MIDWAY }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const dimOfRunning = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const cells = await ui.findAll({ type: 'Text', text: /^■ $/ })
    const running = cells.find(cell => cell.props.color === 'cyan')
    await ui.unmount()

    return running?.props.dimColor
  }

  const before = await dimOfRunning()
  await clock.advance(600)
  expect(await dimOfRunning()).toBe(!before)

  const spinner = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const found = await ui.find({ type: 'Text', text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] $/ })
    await ui.unmount()

    return found
  }

  const first = await spinner()
  expect(first?.text).toBeDefined()
  await clock.advance(150)
  expect((await spinner())?.text).not.toBe(first?.text)

  const colorBefore = (await spinner())?.props.color
  await clock.advance(600)
  expect((await spinner())?.props.color).not.toBe(colorBefore)
  expect([colorBefore, (await spinner())?.props.color].sort()).toEqual(['#2EAD33', '#D65348'])
})

test('the stop button interrupts the run with SIGINT so the report is written', async ($, on) => {
  const clock = mock.clock(on)
  const stopped: unknown[] = []
  const signalled: string[][] = []
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskStop') {
      stopped.push(e)

      return { result: { message: 'stopped' } }
    }

    return BACKGROUNDED
  })
  on('process.run', ($, e) => {
    signalled.push([...e.argv])

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: MIDWAY }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('red')
  await ui.press({ key: 'stop' })
  await ui.unmount()

  expect(signalled).toEqual([['sh', '-c', expect.stringContaining('kill -INT -"$pgid"')]])
  expect(stopped).toEqual([])
})

test('the stop button falls back to TaskStop when no run process is found', async ($, on) => {
  const clock = mock.clock(on)
  const stopped: unknown[] = []
  on('tool.call', ($, e) => {
    if (e.tool === 'TaskStop') {
      stopped.push(e)

      return { result: { message: 'stopped' } }
    }

    return BACKGROUNDED
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: MIDWAY }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'stop' })
  await ui.unmount()

  expect(stopped).toEqual([expect.objectContaining({ tool: 'TaskStop', task_id: 'b1' })])
})

test('the ETA appears once 5 tests are done, from elapsed time per finished test', async ($, on) => {
  const clock = mock.clock(on)
  const lines = (count: number) =>
    Array.from({ length: count }, (_, i) => `  ✓  ${i + 1} [chromium] › tests/e.spec.ts:${i + 1}:1 › T${i + 1} (1.0s)`).join('\n')
  let finished = 4
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: `Running 10 tests using 2 workers\n\n${lines(finished)}\n` }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(8_000)

  const early = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(early, /left/)).toBeUndefined()
  await early.unmount()

  finished = 5
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /^ · ~10s left$/)).toBeDefined()
  await ui.unmount()
})

test('Details lists the failed and flaky tests with file, name and duration', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: FINISHED.replace('  ✓  4 [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop (15.5s)', '  ✘  4 [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop (15.5s)') }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /a\.spec\.ts:30/)).toBeUndefined()
  await ui.press({ key: 'details' })
  const failed = await ui.find({ type: 'Text', text: /^✘ a\.spec\.ts:30  A › WS03 - Adds  15\.5s\s*$/ })
  expect(failed?.props.color).toBe('red')
  const flaky = await ui.find({ type: 'Text', text: /^~ a\.spec\.ts:20  A › WS02 - Explores  14\.4s \(passed on retry\)\s*$/ })
  expect(flaky?.props.color).toBe('yellow')
  await ui.press({ key: 'details' })
  expect(await text(ui, /a\.spec\.ts:30/)).toBeUndefined()
  await ui.unmount()
})

test('once the run is done, Open report shows the report from the html outputFolder in the config', async ($, on) => {
  const clock = mock.clock(on)
  const spawned: (readonly string[])[] = []
  const statted: string[] = []
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', ($, e) => ({
    value: e.path.endsWith('playwright.config.ts')
      ? "reporter: [['list'], ['html', { outputFolder: './reports/html' }]],"
      : FINISHED,
  }))
  on('fs.stat', ($, e) => {
    statted.push(e.path.replaceAll('\\', '/'))

    return statReport($, e)
  })
  on('process.spawn', async function* ($, e) {
    spawned.push(e.argv)

    return { value: { code: 0, signal: null } }
  })

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^● $/ }))?.props.color).toBe('green')
  await ui.press({ key: 'report' })
  await clock.settle()
  await ui.unmount()

  expect(spawned).toEqual([['npx', 'playwright', 'show-report', './reports/html']])
  expect(statted.some(path => path.endsWith('reports/html/index.html'))).toBe(true)
})

test('without an html outputFolder in the config, Open report uses the default folder', async ($, on) => {
  const clock = mock.clock(on)
  const spawned: (readonly string[])[] = []
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('playwright.config.ts') ? "reporter: [['list'], ['html']]," : FINISHED }))
  on('fs.stat', statReport)
  on('process.spawn', async function* ($, e) {
    spawned.push(e.argv)

    return { value: { code: 0, signal: null } }
  })

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'report' })
  await clock.settle()
  await ui.unmount()

  expect(spawned).toEqual([['npx', 'playwright', 'show-report']])
})

// Each case: the config's text (null: no config) and the command; whether Runboard follows the run.
for (const [name, config, command, isFollowed] of [
  ['no reporter in the config means the local default, list', 'export default defineConfig({ retries: 1 })', 'npx playwright test', true],
  ['the config names list', "reporter: [['list'], ['html']],", 'npx playwright test', true],
  ['the config picks list locally', "reporter: process.env.CI ? 'dot' : 'list',", 'npx playwright test', true],
  ['no config to read', null, 'npx playwright test', true],
  ['html alone', "reporter: 'html',", 'npx playwright test', false],
  ['html alone, list only in a comment', "// reporter: 'list',\n  /* or 'list' */\n  reporter: [['html', { open: 'never' }]],", 'npx playwright test', false],
  ['a --reporter flag without list', "reporter: [['list'], ['html']],", 'npx playwright test --reporter=dot', false],
  ['a --reporter flag with list', "reporter: 'html',", 'npx playwright test --reporter=list,html', true],
] as const) {
  test(`${isFollowed ? 'follows' : 'stays off, with a toast,'}: ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    const commands: string[] = []
    const toasts: string[] = []
    on('tool.call', ($, e) => {
      if (e.tool === 'Bash') commands.push(e.command)

      return BACKGROUNDED
    })
    on('ui.render', () => ({ type: 'Box', children: [] }))
    on('session.cwd', () => ({ value: '/home/me/shop' }))
    on('fs.read', ($, e) => {
      if (/playwright\.config\.\w+$/.test(e.path)) {
        if (config === null || !e.path.endsWith('.ts')) throw new Error('ENOENT')

        return { value: config }
      }

      return { value: MIDWAY }
    })
    on('ui.toast', ($, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })

    await $.tool.call({ tool: 'Bash', command, run_in_background: true })
    await clock.advance(2_000)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await text(ui, /1 passed/)) !== undefined).toBe(isFollowed)
    await ui.unmount()

    expect(commands).toEqual([command])
    expect(toasts).toEqual(isFollowed ? [] : [expect.stringContaining("needs the list reporter in playwright.config")])
  })
}

test('the reporter is read from the folder the run cds into', async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('session.cwd', () => ({ value: '/home/me' }))
  on('fs.read', ($, e) => {
    if (e.path.replaceAll('\\', '/').endsWith('/home/me/shop/playwright.config.ts')) return { value: "reporter: 'html'," }
    if (/playwright\.config\.\w+$/.test(e.path)) throw new Error('ENOENT')

    return { value: MIDWAY }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.tool.call({ tool: 'Bash', command: 'cd shop && npx playwright test', run_in_background: true })
  await clock.advance(2_000)

  expect(toasts).toHaveLength(1)
})

// `stat` answers the report's index.html on each look: a value, or null for no file there.
const runWithReport = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  stat: () => typeof FRESH_REPORT | { value: { kind: 'file'; size: number; mtimeMs: number; isLink: boolean } } | null,
) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('playwright.config.ts') ? "reporter: [['list'], ['html']]," : FINISHED }))
  on('fs.stat', ($, e) => {
    if (!e.path.endsWith('index.html')) throw new Error('ENOENT')
    const answer = stat()
    if (answer === null) throw new Error('ENOENT')

    return answer
  })

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  await clock.advance(2_000)

  return clock
}

for (const [name, stat] of [
  ['wrote no report', () => null],
  ['left an older report (--reporter=list)', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: -1, isLink: false } })],
] as const) {
  test(`a run that ${name} shows no Open report`, async ($, on) => {
    const clock = await runWithReport($, on, stat)
    await clock.advance(60_000)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await text(ui, /done/)).toBeDefined()
    expect(await ui.find({ key: 'report' })).toBeUndefined()
    await ui.unmount()
  })
}

test('Open report appears once the report is written, which can be after the summary', async ($, on) => {
  let looks = 0
  const clock = await runWithReport($, on, () => (++looks < 3 ? null : FRESH_REPORT))

  const early = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await early.find({ key: 'report' })).toBeUndefined()
  await early.unmount()

  await clock.advance(4_000)
  const later = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await later.find({ key: 'report' })).toBeDefined()
  await later.unmount()

  await clock.advance(60_000)
  expect(looks).toBe(3)
})

test('Details shows the last error of each failure and opens its trace', async ($, on) => {
  const clock = mock.clock(on)
  const spawned: (readonly string[])[] = []
  const output = `Running 1 test using 1 worker

  ✘  1 [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop (2.0s)
  ✘  2 [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop (retry #1) (2.1s)

  1) [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop 

    Error: first attempt error

    attachment #3: trace (application/zip) ───
    reports/test-results/a-WS03/trace.zip

    Retry #1 ───

    Error: expect(received).toBe(expected)

    Expected: 500
    Received: 302

    attachment #3: trace (application/zip) ───
    reports/test-results/a-WS03-retry1/trace.zip
    Usage:

        npx playwright show-trace reports/test-results/a-WS03-retry1/trace.zip

  1 failed
`
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: output }))
  on('process.spawn', async function* ($, e) {
    spawned.push(e.argv)

    return { value: { code: 0, signal: null } }
  })

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'details' })
  expect(await text(ui, /^  expect\(received\)\.toBe\(expected\) · Expected: 500 · Received: 302$/)).toBeDefined()
  await ui.press({ key: 'trace-0' })
  await clock.settle()
  await ui.unmount()

  expect(spawned).toEqual([['npx', 'playwright', 'show-trace', 'reports/test-results/a-WS03-retry1/trace.zip']])
})

const WITH_TRACE = `Running 1 test using 1 worker

  ✘  1 [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop (2.0s)

  1) [chromium] › tests/a.spec.ts:30:5 › A › WS03 - Adds @shop

    Error: boom

    attachment #1: trace (application/zip) ───
    test-results/a-WS03/trace.zip

  1 failed
`

// The engine resolves a read's path for the host (on Windows with a drive and backslashes), so compare the tail.
const readsConfigIn = (read: string[], folder: string) => {
  const slashed = (path: string) => path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

  return read.some(path => slashed(path).endsWith(`${slashed(folder)}/playwright.config.ts`))
}

// Runs `command` in the background from a session in `sessionCwd`, then moves the session elsewhere, as
// Claude Code does between turns, and opens the finished band; `spawn` answers each spawned child.
const finishedRun = async (
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  { command, sessionCwd, spawn, output = WITH_TRACE, home }: {
    command: string
    sessionCwd: string
    output?: string
    home?: string
    spawn?: () => { chunks: { stream: 'stdout' | 'stderr'; text: string }[]; code: number }
  },
) => {
  const clock = mock.clock(on)
  const spawned: { argv: readonly string[]; cwd: string | undefined }[] = []
  const read: string[] = []
  const toasts: string[] = []
  let cwd = sessionCwd
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('session.cwd', () => ({ value: cwd }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? home : undefined }))
  on('fs.read', ($, e) => {
    read.push(e.path)

    return { value: e.path.endsWith('playwright.config.ts') ? "reporter: [['list'], ['html']]," : output }
  })
  on('process.spawn', async function* ($, e) {
    spawned.push({ argv: e.argv, cwd: e.cwd })
    const { chunks, code } = spawn?.() ?? { chunks: [], code: 0 }
    for (const chunk of chunks) yield chunk

    return { value: { code, signal: null } }
  })
  on('fs.stat', statReport)
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.tool.call({ tool: 'Bash', command })
  await clock.advance(2_000)
  cwd = '/somewhere/else'

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  return { ui, clock, spawned, read, toasts }
}

test('Open report and Trace run in the folder the run ran in, not where the session is now', async ($, on) => {
  const { ui, clock, spawned, read } = await finishedRun($, on, {
    command: 'npx playwright test',
    sessionCwd: '/home/me/shop',
  })
  await ui.press({ key: 'report' })
  await ui.press({ key: 'details' })
  await ui.press({ key: 'trace-0' })
  await clock.settle()
  await ui.unmount()

  expect(spawned).toEqual([
    { argv: ['npx', 'playwright', 'show-report'], cwd: '/home/me/shop' },
    { argv: ['npx', 'playwright', 'show-trace', 'test-results/a-WS03/trace.zip'], cwd: '/home/me/shop' },
  ])
  expect(readsConfigIn(read, '/home/me/shop')).toBe(true)
})

for (const [command, sessionCwd, expected] of [
  ['cd e2e && npx playwright test', '/home/me/shop', '/home/me/shop/e2e'],
  ["cd '/srv/app' ; npx playwright test", '/home/me/shop', '/srv/app'],
  [
    'cd "/g/Documents/Programming Projects/spp" && npx playwright test',
    'G:\\Documents\\Programming Projects',
    'G:/Documents/Programming Projects/spp',
  ],
  ['cd C:\\work\\spp && npx playwright test', 'G:\\Documents', 'C:\\work\\spp'],
] as const) {
  test(`a leading cd moves the run: ${command}`, async ($, on) => {
    const { ui, clock, spawned, read } = await finishedRun($, on, { command, sessionCwd })
    await ui.press({ key: 'report' })
    await clock.settle()
    await ui.unmount()

    expect(spawned.map(child => child.cwd)).toEqual([expected])
    expect(readsConfigIn(read, expected)).toBe(true)
  })
}

for (const [command, home, expected] of [
  ['cd ~/shop && npx playwright test', '/Users/me', '/Users/me/shop'],
  ['cd "$HOME/my shop" && npx playwright test', '/Users/me', '/Users/me/my shop'],
  ['cd ${HOME}/shop && npx playwright test', '/Users/me', '/Users/me/shop'],
  ['cd ~ && npx playwright test', '/Users/me', '/Users/me'],
  ["cd '~/shop' && npx playwright test", '/Users/me', '/Users/me/project/~/shop'],
  ['cd ~/shop && npx playwright test', undefined, '/Users/me/project'],
  ['cd $WORKSPACE/shop && npx playwright test', '/Users/me', '/Users/me/project'],
] as const) {
  test(`the home folder in a leading cd is followed: ${command} (HOME ${home ?? 'unset'})`, async ($, on) => {
    const { ui, clock, spawned } = await finishedRun($, on, { command, sessionCwd: '/Users/me/project', home })
    await ui.press({ key: 'report' })
    await clock.settle()
    await ui.unmount()

    expect(spawned.map(child => child.cwd)).toEqual([expected])
  })
}

test('a failure header padded with a ─ rule, as Playwright writes it, still gets its error and trace', async ($, on) => {
  const { ui, clock, spawned } = await finishedRun($, on, {
    command: 'npx playwright test',
    sessionCwd: '/home/me/shop',
    output: WITH_TRACE.replace(/^( {2}1\) .*?)\s*$/m, `$1 ${'─'.repeat(40)}`),
  })
  await ui.press({ key: 'details' })
  expect(await text(ui, /^  boom$/)).toBeDefined()
  await ui.press({ key: 'trace-0' })
  await clock.settle()
  await ui.unmount()

  expect(spawned.map(child => child.argv)).toEqual([['npx', 'playwright', 'show-trace', 'test-results/a-WS03/trace.zip']])
})

test("Open report and Trace run the project's own Playwright CLI with node when it's installed", async ($, on) => {
  const clock = mock.clock(on)
  const spawned: (readonly string[])[] = []
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('session.cwd', () => ({ value: '/home/me/shop' }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('playwright.config.ts') ? "reporter: [['list'], ['html']]," : WITH_TRACE }))
  on('fs.stat', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    if (path.endsWith('index.html') || path.endsWith('node_modules/@playwright/test/cli.js')) return FRESH_REPORT
    throw new Error('ENOENT')
  })
  on('process.spawn', async function* ($, e) {
    spawned.push(e.argv)

    return { value: { code: 0, signal: null } }
  })

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'report' })
  await ui.press({ key: 'details' })
  await ui.press({ key: 'trace-0' })
  await clock.settle()
  await ui.unmount()

  expect(spawned).toEqual([
    ['node', '/home/me/shop/node_modules/@playwright/test/cli.js', 'show-report'],
    ['node', '/home/me/shop/node_modules/@playwright/test/cli.js', 'show-trace', 'test-results/a-WS03/trace.zip'],
  ])
})

test('a crash toast names the error, not the source location Node opens with', async ($, on) => {
  const { ui, clock, toasts } = await finishedRun($, on, {
    command: 'npx playwright test',
    sessionCwd: '/home/me/shop',
    spawn: () => ({
      chunks: [
        {
          stream: 'stderr',
          text: 'node:net:1940\n    const ex = new UVExceptionWithHostPort(err, \'listen\', address, port);\n\nError: listen EADDRINUSE: address already in use ::1:9323\n    at Server.setupListenHandle\n',
        },
      ],
      code: 1,
    }),
  })
  await ui.press({ key: 'report' })
  await clock.settle()
  await ui.unmount()

  expect(toasts).toEqual(['show-report failed: Error: listen EADDRINUSE: address already in use ::1:9323'])
})

for (const [name, answer, toast] of [
  ['denied', { deny: 'the person declined' }, "Stop run wasn't allowed: the person declined"],
  ['failed', { result: 'No task found with ID: b1', isError: true, text: 'No task found with ID: b1' }, 'Stop run failed: No task found with ID: b1'],
] as const) {
  test(`when TaskStop is ${name}, Stop run says so instead of doing nothing`, async ($, on) => {
    const clock = mock.clock(on)
    const toasts: string[] = []
    on('tool.call', ($, e) => (e.tool === 'TaskStop' ? answer : BACKGROUNDED))
    on('process.run', () => ({
      value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('ui.render', () => ({ type: 'Box', children: [] }))
    on('fs.read', () => ({ value: MIDWAY }))
    on('ui.toast', ($, e) => {
      toasts.push(e.text)

      return { value: undefined }
    })

    await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
    await clock.advance(2_000)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.press({ key: 'stop' })
    await ui.unmount()

    expect(toasts).toEqual([toast])
  })
}

test("on Windows Stop ends the run's own Playwright process tree, and the run ends as stopped", async ($, on) => {
  const clock = mock.clock(on)
  const ran: { argv: readonly string[]; env?: Record<string, string> }[] = []
  const tools: string[] = []
  const toasts: string[] = []
  let output = 'Running 3 tests using 1 worker\n\n  ✓  1 [chromium] › tests\\a.spec.ts:10:5 › A › one (1.0s)\n'
  on('tool.call', ($, e) => {
    tools.push(e.tool)

    return BACKGROUNDED
  })
  on('process.run', ($, e) => {
    ran.push({ argv: e.argv, env: e.init?.env })
    // sh finds no process group on Windows; the PowerShell kill finds the run.
    const exitCode = e.argv[0] === 'powershell' ? 0 : 1

    return { value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('session.cwd', () => ({ value: 'G:\\Documents\\shop' }))
  on('fs.read', () => ({ value: output }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test', run_in_background: true })
  await clock.advance(2_000)

  const running = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await running.press({ key: 'stop' })
  await running.unmount()

  expect(ran.map(call => call.argv[0])).toEqual(['sh', 'powershell'])
  expect(ran[1]?.env).toEqual({ RUNBOARD_DIR: 'G:\\Documents\\shop' })
  expect(tools).toEqual(['Bash'])
  expect(toasts).toEqual([])

  // The killed tree ends the task with no summary and no [killed] line.
  output += '\n[exited with code 1]\n'
  await clock.advance(2_000)
  const stopped = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(stopped, /^ \(stopped\) $/)).toBeDefined()
  expect(await text(stopped, /^ · 2 not run$/)).toBeDefined()
  await stopped.unmount()
})

test('off Windows Stop never runs the PowerShell kill', async ($, on) => {
  const clock = mock.clock(on)
  const ran: string[] = []
  on('tool.call', ($, e) => (e.tool === 'TaskStop' ? { result: { message: 'stopped' } } : BACKGROUNDED))
  on('process.run', ($, e) => {
    ran.push(e.argv[0] ?? '')

    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('session.cwd', () => ({ value: '/home/me/shop' }))
  on('fs.read', () => ({ value: MIDWAY }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test', run_in_background: true })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'stop' })
  await ui.unmount()

  expect(ran).toEqual(['sh'])
})

test('when show-report fails, a toast says why instead of the button doing nothing', async ($, on) => {
  const { ui, clock, toasts } = await finishedRun($, on, {
    command: 'npx playwright test',
    sessionCwd: '/home/me/shop',
    spawn: () => ({
      chunks: [{ stream: 'stderr', text: '\x1b[31mNo report found at "/home/me/shop/playwright-report"\x1b[39m\n' }],
      code: 1,
    }),
  })
  await ui.press({ key: 'report' })
  await clock.settle()
  await ui.unmount()

  expect(toasts).toEqual(['show-report failed: No report found at "/home/me/shop/playwright-report"'])
})

test('when show-trace fails, a toast says why', async ($, on) => {
  const { ui, clock, toasts } = await finishedRun($, on, {
    command: 'npx playwright test',
    sessionCwd: '/home/me/shop',
    spawn: () => ({ chunks: [{ stream: 'stderr', text: '\nError: trace file not found\n  at x\n' }], code: 1 }),
  })
  await ui.press({ key: 'details' })
  await ui.press({ key: 'trace-0' })
  await clock.settle()
  await ui.unmount()

  expect(toasts).toEqual(['show-trace failed: Error: trace file not found'])
})

test('a report that opens, or one replaced by a second press, raises no toast', async ($, on) => {
  const { ui, clock, spawned, toasts } = await finishedRun($, on, {
    command: 'npx playwright test',
    sessionCwd: '/home/me/shop',
    spawn: () => ({ chunks: [{ stream: 'stdout', text: 'Serving HTML report at http://localhost:9323.\n' }], code: 0 }),
  })
  await ui.press({ key: 'report' })
  await ui.press({ key: 'report' })
  await clock.settle()
  await ui.unmount()

  expect(spawned).toHaveLength(2)
  expect(toasts).toEqual([])
})

test('colour codes and Windows paths in the output still parse', async ($, on) => {
  const clock = mock.clock(on)
  const output = [
    'Running 2 tests using 2 workers',
    '',
    '\x1b[1A\x1b[2K  \x1b[32m✓\x1b[39m  1 [chromium] › tests\\a.spec.ts:10:5 › A › One (1.0s)',
    '\x1b[1A\x1b[2K  \x1b[31m✘\x1b[39m  2 [chromium] › tests\\sub\\b.spec.ts:20:5 › B › Two (2.0s)',
    '',
    '\x1b[1A\x1b[2K  1) [chromium] › tests\\sub\\b.spec.ts:20:5 › B › Two ',
    '',
    '    Error: boom',
    '',
    '\x1b[1A\x1b[2K  \x1b[31m1 failed\x1b[39m',
    '\x1b[1A\x1b[2K  \x1b[32m1 passed\x1b[39m (2.1s)',
    '',
  ].join('\n')
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: output }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /done/)).toBeDefined()
  expect(await text(ui, /1 passed/)).toBeDefined()
  expect(await text(ui, /1 failed/)).toBeDefined()
  await ui.press({ key: 'details' })
  expect(await text(ui, /^✘ b\.spec\.ts:20  B › Two  2\.0s/)).toBeDefined()
  expect(await text(ui, /^  boom$/)).toBeDefined()
  await ui.unmount()
})

test('Details starts closed on every new run', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: FINISHED }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)
  const first = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await first.press({ key: 'details' })
  expect(await text(first, /passed on retry/)).toBeDefined()
  await first.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)
  const second = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(second, /passed on retry/)).toBeUndefined()
  await second.unmount()
})

const PACKAGE_JSON = JSON.stringify({
  scripts: {
    'test:smoke': 'ENV=local playwright test --project=chromium --grep @smoke',
    'show-report': 'npx playwright show-report reports/html',
    'list:all': 'playwright test --list',
    'open:local': 'ENV=local playwright test --ui --project=chromium',
    lint: 'npm run type-check && eslint .',
  },
})

for (const [command, isTracked] of [
  ['npm run test:smoke -- --retries=1', true],
  ['npx playwright test --list --project=chromium', false],
  ['npm run show-report', false],
  ['npm run list:all', false],
  ['npm run open:local', false],
  ['npm run lint', false],
] as const) {
  test(`${isTracked ? 'tracks' : 'ignores'}: ${command}`, async ($, on) => {
    const clock = mock.clock(on)
    on('tool.call', () => BACKGROUNDED)
    on('ui.render', () => ({ type: 'Box', children: [] }))
    on('fs.read', ($, e) => ({ value: e.path.endsWith('package.json') ? PACKAGE_JSON : MIDWAY }))

    await $.tool.call({ tool: 'Bash', command })
    await clock.advance(2_000)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await text(ui, /1 passed/)) !== undefined).toBe(isTracked)
    await ui.unmount()
  })
}

test('a reload keeps following the background run it was on', async ($, on) => {
  const clock = mock.clock(on)
  let output = MIDWAY
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: output }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const reloaded = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(reloaded, /1 passed/)).toBeDefined()
  await reloaded.unmount()

  output = FINISHED
  await clock.advance(2_000)
  const done = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(done, /done/)).toBeDefined()
  expect(await text(done, /2 passed/)).toBeDefined()
  await done.unmount()
})

test('after a finished run, a reload clears the band', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: FINISHED }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --project=chromium' })
  await clock.advance(2_000)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /passed/)).toBeUndefined()
  await ui.unmount()
})

for (const [name, output, needsList] of [
  ['line/html reporter progress', 'Running 2 tests using 2 workers\n\n[1/2] [chromium] › tests\\example.spec.ts:3:5 › has title\n', true],
  ['dot reporter summary', 'Running 2 tests using 1 worker\n··\n  2 passed (1.0s)\n', true],
  ['a run stopped before any test finished', 'Running 2 tests using 1 worker\n\n[killed]\n', false],
  ['list reporter output', MIDWAY, false],
] as const) {
  test(`${needsList ? 'asks' : 'does not ask'} for the list reporter: ${name}`, async ($, on) => {
    const clock = mock.clock(on)
    on('tool.call', () => BACKGROUNDED)
    on('ui.render', () => ({ type: 'Box', children: [] }))
    on('fs.read', () => ({ value: output }))

    await $.tool.call({ tool: 'Bash', command: 'npx playwright test' })
    await clock.advance(2_000)

    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect((await text(ui, /needs the list reporter/)) !== undefined).toBe(needsList)
    expect((await text(ui, /passed/)) !== undefined).toBe(!needsList)
    await ui.unmount()
  })
}

for (const [label, background, command, passedOn] of [
  ['drops a buffering tail', true, 'npx playwright test -g "A" 2>&1 | tail -40', 'npx playwright test -g "A"'],
  ['drops a bare tail', true, 'npx playwright test | tail -20', 'npx playwright test'],
  ['drops a trailing head', true, 'npx playwright test 2>&1 | head -5', 'npx playwright test'],
  [
    'keeps a streaming grep',
    true,
    'npx playwright test | grep --line-buffered ✘',
    'npx playwright test | grep --line-buffered ✘',
  ],
  [
    'keeps a tail in the foreground',
    false,
    'npx playwright test 2>&1 | tail -40',
    'npx playwright test 2>&1 | tail -40',
  ],
] as const) {
  test(`${label}: ${command}`, async ($, on) => {
    const clock = mock.clock(on)
    let ran = ''
    on('tool.call', ($, e) => {
      if (e.tool === 'Bash') ran = e.command

      return BACKGROUNDED
    })
    on('ui.render', () => ({ type: 'Box', children: [] }))
    on('fs.read', () => ({ value: MIDWAY }))

    await $.tool.call({ tool: 'Bash', command, ...(background ? { run_in_background: true } : {}) })
    await clock.advance(2_000)

    expect(ran).toBe(passedOn)
    // The band showing the run is what proves the hook ran at all, so a no-change case cannot pass dead.
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await text(ui, /1 passed/)).toBeDefined()
    expect(await text(ui, new RegExp(`^\\$ ${passedOn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`))).toBeDefined()
    await ui.unmount()
  })
}

const REPEATED = `Running 4 tests using 1 worker

  ✓  1 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (29.8s)
  ✓  2 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (28.1s)
  ✓  3 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (27.4s)
  ✓  4 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (26.9s)

  4 passed (1.9m)
`

test('--repeat-each repeats of one title each keep their own square', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: REPEATED }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --repeat-each=4' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /4 passed/)).toBeDefined()
  expect(await text(ui, /flaky/)).toBeUndefined()
  expect(await text(ui, / · 4\/4$/)).toBeDefined()
  const cells = await ui.findAll({ type: 'Text', text: /^■ $/ })
  expect(cells.map(cell => cell.props.color)).toEqual(['green', 'green', 'green', 'green'])
  await ui.unmount()
})

const REPEATED_WITH_RETRY = `Running 3 tests using 1 worker

  ✘  1 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (1.0s)
  ✓  2 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (retry #1) (1.1s)
  ✓  3 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (1.2s)
  ✘  4 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (1.3s)

  1 flaky
  1 passed
  1 failed
`

test('a retry folds into its own repeat, while later repeats of the same title stand apart', async ($, on) => {
  const clock = mock.clock(on)
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: REPEATED_WITH_RETRY }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --repeat-each=3 --retries=1' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await text(ui, /1 passed/)).toBeDefined()
  expect(await text(ui, /1 failed/)).toBeDefined()
  expect(await text(ui, /1 flaky/)).toBeDefined()
  // The retry replaced its own attempt, so three repeats leave three squares, not four.
  const cells = await ui.findAll({ type: 'Text', text: /^■ $/ })
  expect(cells.map(cell => cell.props.color)).toEqual(['yellow', 'green', 'red'])
  await ui.unmount()
})

test('each failing repeat is listed separately in Details, with its own duration', async ($, on) => {
  const clock = mock.clock(on)
  const output = `Running 2 tests using 1 worker

  ✘  1 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (1.0s)
  ✘  2 [chromium] › tests/a.spec.ts:10:5 › A › WS01 - Browses @shop (2.5s)

  2 failed (4.0s)
`
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', () => ({ value: output }))

  await $.tool.call({ tool: 'Bash', command: 'npx playwright test --repeat-each=2' })
  await clock.advance(2_000)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'details' })
  expect(await text(ui, /1\.0s/)).toBeDefined()
  expect(await text(ui, /2\.5s/)).toBeDefined()
  await ui.unmount()
})
