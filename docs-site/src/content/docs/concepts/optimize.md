---
title: "Optimization: The Agent Gets Better As It Runs"
description: Reading real session history to tune the agent — autonomous tuning today, model replacement next
---

Building an agent and distributing it isn't the finish line. It handles real work every day, and that **session history** is the best material there is for improving it: where it went the long way round, which stretch of prompt keeps confusing it, which steps are slow and expensive. It's all in there. Optimization is letting the agent read its own history and tune itself to be more accurate and cheaper.

Two numbers anchor it: **cost per task** and **task success rate**, a task being one whole piece of work you hand over.

## Autonomous tuning (live)

The agent finds the waste in its own history and refines its prompts and skills: clarifying a system prompt that reads ambiguously, pulling capabilities that are never needed at the same time out into on-demand skills, turning frequent or flaky steps into scripts. The longer it runs, the sharper and more token-efficient it gets.

For how a change actually lands and gets approved, see [Builder Mode](/concepts/builder-mode/): the agent lists the relevant sessions itself, downloads and reads them on demand, and proposes changes — each one taking effect only after you approve it.

## Model replacement (planned)

Building an evaluation set out of session history, then checking whether a cheaper model holds up on it. This is the hard half: it needs a regressible test suite extracted from real sessions, and an evaluation capability to run it, before an expensive model can be swapped out without losing quality. Still being built.
