# @neutree-ai/sse-consumer

Reads the Neutree Agent Platform's turn streams (`text/event-stream` of UniversalEvent frames). The control plane, the scheduler, the web app and `@neutree-ai/ui-sdk` all read them through it.

- `readSSE(response, { signal })`: the SSE lines of a response, as `{ event, data }`. It knows nothing about the platform.
- `runTurn(source, plugins)`: one turn, from `session.started` to `session.ended`. It parses each frame, hands it to the plugins, applies an idle timeout, and reconnects once through `source.reconnect`.
- The wire types: `UniversalEvent`, `UniversalItem`, `ContentPart`, `ContentDelta`, `TurnStats`, `ContextGauge`, `ChatImageAttachment`.

Inside the repo, code imports it from source. The package is built (`npm run build`) only for publishing.
