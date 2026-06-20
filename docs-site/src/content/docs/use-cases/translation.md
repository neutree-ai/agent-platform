---
title: Product Documentation Translation
description: A docs team uses Neutree Agent Platform to translate product UI and external-facing documentation
---

> A docs team uses Neutree Agent Platform (NAP) to translate product UI and external-facing documentation, replacing traditional translation platforms like Crowdin with a more flexible, faster workflow.

## Prerequisites

- Access to a GitLab repository (where the source files to be translated live)
- A Slack Connector (to receive ad-hoc translation requests from the team)
- The translation-related MCP Servers deployed: Translation Review, Translation Memory (TM), Glossary, QA Rule

## How to Trigger

Start a translation task from the Chat in the NAP Web UI. The translation team describes the request in plain language, for example:

- "Translate the incremental changes from the latest commit in the xx repository"
- "Pull today's translation requests from the Slack #translation-requests channel"

## Workspace Configuration

| Setting | Value |
| --- | --- |
| Agent Core | Codex (switched seamlessly from Claude Code, see the note below) |
| Model | GPT |
| MCP Servers | Translation Review, Translation Memory, Glossary, QA Rule |
| Skills | Slack API |

### Swapping the Agent Core Without Changing the Workflow

Early in the project the team used Claude Code with a Claude model. At one point the underlying model API went down, so the team switched the Agent Core to Codex + GPT, and the translation workflow kept running with the prompt and workflow configuration completely unchanged. Because NAP keeps the Agent Core and the Model separate, your work isn't locked to a single vendor.

## End-to-End Workflow

A typical translation task:

1. **Initiate** — The translation team describes the translation request in Chat
2. **Fetch** — The Agent pulls source files from the GitLab repository and identifies the incremental changes; or it pulls ad-hoc translation requests via the Slack API
3. **Translate** — The Agent queries the TM to reuse existing translations, consults the Glossary to keep terminology consistent, and then translates
4. **Quality Check** — The QA Rule MCP automatically checks translation quality (formatting, terminology, wording consistency, etc.)
5. **Review** — The translation results enter the Review Tab, where the team goes through them one by one in a dedicated review interface
6. **Submit** — Once approved, the Agent commits the translation results back to the repository

## Key Points

### A Dedicated Translation Review Interface

The Workspace's Review Tab approaches the review workflow of professional translation software:

- **Line-by-line comparison**: source and translation are shown side by side, with row-level key-value alignment for JSON files
- **Inline editing**: edit the translation directly in the review interface, without going back to Chat
- **Terminology highlighting**: terms from the Glossary are automatically detected and highlighted, with hover tooltips showing the term's definition and usage
- **Status tracking**: each translation is marked as Approved / Edited / Rejected, and a progress bar shows overall review progress in real time
- **Reject requires a reason**: a reason is mandatory when you click Reject

### Four MCP Servers, Each Owning One Stage

| MCP Server | Role |
| --- | --- |
| Translation Review | Manages the translation review workflow, with chunk-level status transitions |
| Translation Memory | Reuses historical translations, unifies wording, and reduces repetitive work |
| Glossary | Terminology management and validation, keeping specialized-term translations consistent |
| QA Rule | Automated quality checks that catch formatting errors and terminology misuse |

### Non-Developers Can Write Their Own CI

The docs team (non-developers) uses NAP to write and maintain CI scripts—for example, an automation that extracts TM data from the translation repository and writes it back—something that wasn't possible before.

### Team Configuration Kept Consistent via Templates and the Prompt Library

The translation team uses NAP's templates and Prompt Library to continuously iterate on the translation workflow. Every team member's Agent syncs in one click, keeping configuration consistent.

## Limitations and Caveats

*No known limitations at this time.*
