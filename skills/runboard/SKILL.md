---
name: runboard
description: How to start, watch and stop Playwright test runs so the Runboard band above the prompt follows them live. Use whenever you run Playwright tests (`playwright test`, or an npm script that runs it) in a session where the Runboard plugin is installed, or when the user asks about the Runboard band.
---

# Running Playwright tests with Runboard

Runboard draws a live band above the prompt for every Playwright run you start with the Bash tool.
You don't call it; it reacts to your Bash commands, and the user works it with its buttons.

## What Runboard does

Tell the user about these when they ask what the band can do:

- **Live progress**: percentage, passed / failed / flaky / skipped counts, `done/total`, elapsed time,
  and an ETA once 5 tests are done.
- **One square per test**: green passed, red failed, yellow flaky (failed, then passed on retry),
  magenta interrupted, hollow skipped, pulsing blue running (one per worker), dim not run yet.
- **`Stop run`**: stops the run while it's going. On macOS and Linux it interrupts it as Ctrl+C does,
  so Playwright still writes the HTML report for the tests that ran. On Windows there's no Ctrl+C for
  another process, so it ends the run's Playwright processes outright: no summary, no report.
- **`(stopped)`**: a run that ended before every test ran (`Stop run`, `--max-failures`, a global
  timeout, a killed task) says so instead of `(done)`. Finished results stay, and interrupted and
  never-started tests are counted apart from failures (`1 interrupted · 2 not run`).
- **`Details`**: the failed, flaky and interrupted tests with their last error, and a `Trace` button
  that opens Playwright's trace viewer where a trace was recorded.
- **`Open report`**: opens the HTML report. It appears only when the run actually wrote one.
- **Toasts**: Runboard says why when it can't help: no `list` reporter (it stays off for that run),
  a report or trace that won't open, a stop that didn't go through.
- It keeps following a run through `/reload-plugins` and clears itself 3 minutes after the run ends.

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
- **Never pass `--reporter`.** It replaces the config's reporters for the run: without `html` in it,
  no HTML report is written and `Open report` doesn't appear.
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
- To stop a run, the user presses `Stop run` on the band; tell them to when they ask you to stop it.
  Don't use TaskStop for a Playwright run: it kills the run with no report, and on Windows it ends
  only the shell while Playwright keeps running, so every test left fails with a crashed worker.
- `/reload-plugins` doesn't lose the run: Runboard resumes following it after a reload.

## When it ends

- A run with a failing test exits with code 1, so its task shows as failed. That's the tests, not the
  run: report the counts and the failed and flaky test names. Get them from the summary at the end of
  the output file (`grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped|interrupted|did not run)"` and
  the lines under it) rather than reading the whole log.
- **A run that ends without Playwright's summary was almost always stopped with `Stop run`** (on
  Windows the button kills it, so Playwright prints nothing more). You don't see the button being
  pressed, so don't guess at outside causes or offer to investigate. Say the run was stopped after
  N of M tests, list what finished, and that there's no report for it.
- A run that printed `N interrupted`, `N did not run` or `Testing stopped early` is partial too
  (`Stop run` on macOS or Linux, `--max-failures`, a global timeout). Report it as partial: the
  passed, failed, interrupted and not-run counts, never as a full result. An interrupted test is not
  a failure; one whose earlier attempt failed before a stopped retry still is, as Playwright counts it.

## Reading the band when the user asks

- `Details` appears only when something failed, flaked or was interrupted, and errors and traces only
  once the run has ended.
- `Trace` shows only where Playwright recorded a trace. With the usual `trace: 'on-first-retry'`, that
  needs retries: a run without them has no traces (`--retries=1` adds them), and a flaky test has none
  either, since its listed attempt is the first one. Say so if the user asks where the traces are.
- No `Open report` after a run means it wrote no report: no html reporter, or the run was killed.
- If `Open report` or `Trace` can't open (a deleted trace, a busy port), a toast says why. The band
  itself doesn't change.
