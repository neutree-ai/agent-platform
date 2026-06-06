# UniversalEvent

Frame payload of the SSE event stream. Each frame is serialized as JSON on a `data: ` line.

**Type:** oneOf

## Composition

- [SessionStartedEvent](SessionStartedEvent.md)
- [SessionEndedEvent](SessionEndedEvent.md)
- [ItemStartedEvent](ItemStartedEvent.md)
- [ItemDeltaEvent](ItemDeltaEvent.md)
- [ItemCompletedEvent](ItemCompletedEvent.md)
- [QuestionRequestedEvent](QuestionRequestedEvent.md)
- [ErrorEvent](ErrorEvent.md)
