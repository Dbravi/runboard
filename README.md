# Runboard

A live Playwright run dashboard above the Claude Code prompt. Ask Claude to run your tests and the
band follows the run as it goes:

```
$ ENV=local npx playwright test --project=chromium --grep @smoke --retries=1
⠹ Runboard 40% · 37 passed · 2 failed · 1 flaky · 1 skipped · 40/100 · 7m00s · ~10m30s left [ ● Stop run ]
■ ■ ■ ■ ■ ■ □ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■
[ Details ]
```

- One square per test: green passed, red failed, yellow flaky (passed on retry), hollow skipped,
  pulsing blue running, dim not run yet.
- Progress, counts, elapsed time and an ETA once 5 tests are done.
- `Stop run` stops the run; once it ends, `Open report` opens the HTML report.
- `Details` lists failed and flaky tests with their error and a `Trace` button that opens the trace.
- Keeps following the run through `/reload-plugins`; clears itself 4 minutes after the run ends.

## Install

In your terminal:

```
claude update
claude plugin marketplace add Dbravi/runboard
claude plugin install runboard@runboard
```

`claude update` matters: older Claude Code versions fail to load the mod (`"session.start" is not an
event`). It is active in the next session you start.

Update to the latest version:

```
claude plugin marketplace update runboard
```

then `/reload-plugins` in a running session.

## Requirements

- **Claude Code 2.1.291 or newer** (`claude update`).
- **The Playwright `list` reporter** in `playwright.config.ts`. Runboard reads its output; with only
  `dot`, `line` or `html` it can't count tests. Playwright uses `list` by default locally and `dot` on CI.
  Without it the band says so instead of counting; with `reporter: 'html'` alone, use
  `reporter: [['list'], ['html']]`.
- **Runs started by Claude.** Runboard sees commands Claude runs, not the ones you type in your own
  terminal. Live updates need a background run (Claude starts long runs that way); a foreground run
  only shows the final result.

## What starts it

- A command containing `playwright test`, e.g. `ENV=local npx playwright test tests/x --project=chromium`.
- `npm run <script>` or `npm test`, when that script in `package.json` runs `playwright test`.
- Ignored: `--list` and `--ui` (they don't run tests), and every other command.

## Good to know

- Ships a `runboard` skill that tells Claude how to start runs so the band works (background, no
  `--reporter`, one run at a time). It loads automatically with the plugin.
- `Stop run` goes through Claude Code's permission check, so the first press may ask for approval.
- `Open report` runs `npx playwright show-report`, passing the html reporter's `outputFolder` from
  `playwright.config` when it sets one (otherwise Playwright's default `playwright-report`).
- Pass no `--reporter` flag to `playwright test`: it replaces the config's reporters, so no HTML
  report gets written.

## Development

```
claude plugin validate .
claude plugin test .
```
