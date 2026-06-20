---
title: "Optimization: Make the Agent Better the More You Use It"
description: Self-refinement by reviewing real session history—autonomous tuning and model replacement
---

Building and distributing an Agent isn't the finish line. It handles real tasks every day, and that **session history** is itself the best material for optimization—where it took detours, which stretch of prompt keeps confusing it, which steps are slow and expensive—it's all recorded in there. Optimization is letting the Agent review its own history to tune itself to be more accurate and more economical.

Optimization always centers on two metrics: **cost per task (cost/task)** and **task success rate**—a task being one general piece of work you hand it.

## Autonomous Tuning (Live)

The Agent discovers inefficiencies from session history and continuously refines its own prompts and skills—clarifying ambiguous system prompts, extracting capabilities that don't need to be active at the same time into on-demand skills, and scripting high-frequency or unstable steps. The more it runs, the more accurate and token-efficient it gets.

For the landing mechanism and approval model, see [Builder Mode](/concepts/builder-mode/): the Agent lists relevant sessions itself, downloads and analyzes them on demand, and proposes changes—each of which takes effect only after your approval.

## Model Replacement (Planned)

Automatically build an evaluation set from session history to verify whether a cheaper model can do the job equally well, driving costs down further. This step is the hardest—it requires extracting a regressible test suite from real sessions, plus a supporting evaluation capability, in order to replace an expensive model with a cheaper one without losing quality. This capability is still under development.
