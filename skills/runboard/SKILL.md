---
name: runboard
description: How to start, watch and stop Playwright test runs so the Runboard band above the prompt follows them live. Use whenever you run Playwright tests (`playwright test`, or an npm script that runs it) in a session where the Runboard plugin is installed, or when the user asks about the Runboard band.
---

# Running Playwright tests with Runboard

Runboard draws a live band above the prompt for every Playwright run you start with the Bash tool:
progress, pass/fail/flaky counts, one square per test, an ETA, a `Stop run` button, failure details
with traces, and `Open report` once the run ends. You don't call it; it reacts to your Bash commands.

## Never change the user's Playwright setup

Runboard counts tests from the `list` reporter's lines. When the run's `playwright.config` sets
reporters without `list` (say `reporter: 'html'` alone), Runboard stays off for that run and shows a
toast saying so. Run the tests anyway, and leave the config and the reporters as they are:

- Don't edit `playwright.config`, not even temporarily, and don't offer to.
- Don't add `--reporter` or reporter environment variables to get the band.

When you report the result, mention once that the band needs the `list` reporter
(`reporter: [['list'], ['html']]`) if the user wants it. That change is theirs to make.

## Start runs so the band works

- **Run in the background** (`run_in_background: true`). Runboard reads the background task's output
  file live. A foreground run only shows the final result once the command returns.
- **Use `playwright test` or an npm script that runs it.** Both are detected:
  `ENV=local npx playwright test tests/x --project=chromium`, `npm run test:local -- --retries=1`.
- **Never pass `--reporter`.** It replaces the config's reporters: the HTML report isn't written and
  `Open report` shows a stale one. Runboard needs the `list` reporter from the config.
- **Don't pipe the run into `tail` or `head`.** They buffer the whole run, so nothing reaches the
  output file until it exits. Runboard drops such a pipe from a background run; read the output file
  afterwards instead. A line-buffered `grep` is fine and is left alone.
- **One run at a time.** A new run takes over the band, and Playwright runs sharing an output folder
  break each other. Stop the current run first.
- **A leading `cd <dir> &&` is fine**: `cd "/path/to/project" && npx playwright test`. Runboard
  remembers that folder, so `Open report` and `Trace` find the report there.
- `--list` and `--ui` are ignored on purpose; they don't run tests.

## While a run is going

- Don't poll the output file to narrate progress; the user is watching the band. Report the result
  when the background task's completion notification arrives.
- To stop a run, press `Stop run` on the band, or tell the user to: it interrupts the run with SIGINT,
  as Ctrl+C does, so Playwright finishes writing the HTML report for the tests that did run. Stopping
  the background task with TaskStop kills it outright and leaves no report.
- `/reload-plugins` doesn't lose the run: Runboard resumes following it after a reload.

## When it ends

- A run with a failing test exits with code 1, so its task shows as failed. That's the tests, not the
  run: report the counts and the failed and flaky test names. Get them from the summary at the end of
  the output file (`grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped)"` and the lines under it)
  rather than reading the whole log.

## Reading the band when the user asks

- Squares: green passed, red failed, yellow flaky (failed then passed on retry), hollow skipped,
  pulsing blue running (one per worker), dim not run yet.
- `Details` lists failed and flaky tests with their last error and a `Trace` button; it appears only
  when something failed, and errors and traces only once the run has ended.
- `Trace` shows only where Playwright recorded a trace. With the usual `trace: 'on-first-retry'`, that
  needs retries: a run without them has no traces (`--retries=1` adds them), and a flaky test has none
  either, since its listed attempt is the first one. Say so if the user asks where the traces are.
- If `Open report` or `Trace` can't open (no report yet, a deleted trace), a toast says why. The band
  itself doesn't change.
- The band clears itself 3 minutes after the run ends.
