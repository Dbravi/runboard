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

test('a new run takes over from one still being polled, and a stopped run ends as done', async ($, on) => {
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
  expect(await text(ui, /done/)).toBeDefined()
  expect(await text(ui, /1 passed/)).toBeDefined()
  expect(await text(ui, /0 failed/)).toBeDefined()
  expect(await text(ui, / · 1\/2$/)).toBeDefined()
  const cells = await ui.findAll({ type: 'Text', text: /^■ $/ })
  expect(cells.some(cell => cell.props.color === 'cyan')).toBe(false)
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
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', ($, e) => ({
    value: e.path.endsWith('playwright.config.ts')
      ? "reporter: [['list'], ['html', { outputFolder: './reports/html' }]],"
      : FINISHED,
  }))
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
})

test('without an html outputFolder in the config, Open report uses the default folder', async ($, on) => {
  const clock = mock.clock(on)
  const spawned: (readonly string[])[] = []
  on('tool.call', () => BACKGROUNDED)
  on('ui.render', () => ({ type: 'Box', children: [] }))
  on('fs.read', ($, e) => ({ value: e.path.endsWith('playwright.config.ts') ? "reporter: 'html'," : FINISHED }))
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
