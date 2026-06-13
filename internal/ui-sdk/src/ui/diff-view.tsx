import { diffLines } from "diff";

/** Build side-by-side diff rows using the `diff` library. */
function sideBySideDiff(oldText: string, newText: string) {
  const changes = diffLines(oldText, newText);
  const left: { text: string; type: "same" | "remove" | "empty" }[] = [];
  const right: { text: string; type: "same" | "add" | "empty" }[] = [];

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, "").split("\n");
    if (change.added) {
      for (const line of lines) {
        left.push({ text: "", type: "empty" });
        right.push({ text: line, type: "add" });
      }
    } else if (change.removed) {
      for (const line of lines) {
        left.push({ text: line, type: "remove" });
        right.push({ text: "", type: "empty" });
      }
    } else {
      for (const line of lines) {
        left.push({ text: line, type: "same" });
        right.push({ text: line, type: "same" });
      }
    }
  }
  return { left, right };
}

const diffLineClass = {
  same: "text-muted-foreground",
  remove: "bg-destructive/10 text-destructive",
  add: "bg-success/10 text-success",
  empty: "bg-muted/30",
};

export function DiffView({
  oldText,
  newText,
  oldLabel,
  newLabel,
}: { oldText: string; newText: string; oldLabel: string; newLabel: string }) {
  const { left, right } = sideBySideDiff(oldText, newText);
  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col border-r border-border">
        <div className="shrink-0 px-3 py-1.5 text-mini text-muted-foreground/50 bg-destructive/5">
          {oldLabel}
        </div>
        <div className="flex-1 overflow-y-auto font-mono text-xs">
          {left.map((line, i) => (
            <div
              key={i}
              className={`px-3 py-px whitespace-pre-wrap min-h-[1.25rem] ${diffLineClass[line.type]}`}
            >
              {line.text || "\u00A0"}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="shrink-0 px-3 py-1.5 text-mini text-muted-foreground/50 bg-success/5">
          {newLabel}
        </div>
        <div className="flex-1 overflow-y-auto font-mono text-xs">
          {right.map((line, i) => (
            <div
              key={i}
              className={`px-3 py-px whitespace-pre-wrap min-h-[1.25rem] ${diffLineClass[line.type]}`}
            >
              {line.text || "\u00A0"}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
