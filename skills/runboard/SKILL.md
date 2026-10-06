---
name: runboard
description: How to start, watch and stop Playwright test runs so the Runboard band above the prompt follows them live. Use whenever you run Playwright tests (`playwright test`, or an npm script that runs it) in a session where the Runboard plugin is installed, or when the user asks about the Runboard band.
---

# Running Playwright tests with Runboard

Runboard draws a live band above the prompt for every Playwright run you start with the Bash tool:
progress, pass/fail/flaky counts, one square per test, an ETA, a `Stop run` button, failure details
with traces, and `Open report` once the run ends. You don't call it; it reacts to your Bash commands.

## Start runs so the band works

- **Run in the background** (`run_in_background: true`). Runboard reads the background task's output
  file live. A foreground run only shows the final result once the command returns.
- **Use `playwright test` or an npm script that runs it.** Both are detected:
  `ENV=local npx playwright test tests/x --project=chromium`, `npm run test:local -- --retries=1`.
- **Never pass `--reporter`.** It replaces the config's reporters: the HTML report isn't written and
  `Open report` shows a stale one. Runboard needs the `list` reporter from the config.
- **One run at a time.** A new run takes over the band, and Playwright runs sharing an output folder
  break each other. Stop the current run first.
- `--list` and `--ui` are ignored on purpose; they don't run tests.

## While a run is going

- Don't poll the output file to narrate progress; the user is watching the band. Report the result
  when the background task's completion notification arrives.
- To stop a run, stop its background task (TaskStop). The band switches to `done` within ~2 seconds.
  The user can also press `Stop run` on the band.
- `/reload-plugins` doesn't lose the run: Runboard resumes following it after a reload.

## Reading the band when the user asks

- Squares: green passed, red failed, yellow flaky (failed then passed on retry), hollow skipped,
  pulsing blue running (one per worker), dim not run yet.
- `Details` lists failed and flaky tests with their last error and a `Trace` button; it appears only
  when something failed, and errors and traces only once the run has ended.
- The band clears itself 4 minutes after the run ends.
