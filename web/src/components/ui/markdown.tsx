import { PlatformCmd } from "@/components/ui/platform-cmd";
import { useSkillsBasePath } from "@/hooks/useSkillsBasePath";
import { useWorkspaceFileLink } from "@/hooks/useWorkspaceFileLink";
import { type DriveKind, fileUrl } from "@/lib/api/agent-files";
import { cn } from "@/lib/utils";
import { canonicalizeAgentPath, isSkillTmpPath } from "@/lib/workspace-file-link";
import { ChevronDown, ExternalLink, Sparkles } from "lucide-react";
import { type ComponentPropsWithoutRef, type ReactNode, memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { harden } from "rehype-harden";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Streamdown } from "streamdown";
import type { PluggableList } from "unified";

interface MarkdownProps {
  children: string;
  mode?: "streaming" | "static";
  className?: string;
  /** When true, /workspace/* links navigate to the file explorer instead of opening a new tab. */
  linkifyWorkspaceFiles?: boolean;
  /** Extra rehype plugins layered on top of streamdown's defaults. */
  rehypePlugins?: PluggableList;
}

function WorkspaceFileLink({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
  const { t } = useTranslation();
  // Resolves agent-emitted `/workspace/*` and `/mnt/afs/*` hrefs into
  // handlers that swap the slotted Files panel / spawn a popout viewer
  // seeded with the right drive. Returns `null` for any other href so we
  // fall through to plain external-link behaviour. Parsing + handler
  // construction live in the hook; see `useWorkspaceFileLink.ts` and the
  // unit-tested parser in `lib/workspace-file-link.ts`.
  const handlers = useWorkspaceFileLink(href);
  if (handlers) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <a
          {...props}
          href={href}
          className="text-primary underline underline-offset-2 cursor-pointer"
          onClick={(e) => {
            e.preventDefault();
            handlers.onLinkClick();
          }}
        >
          {children}
        </a>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-primary"
          title={t("components.fileViewer.actions.openInOverlay")}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handlers.onPopoutClick();
          }}
        >
          <ExternalLink className="h-3 w-3" />
        </button>
      </span>
    );
  }
  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

// Agents emit markdown like `![alt](/workspace/.home/foo.png)` referencing
// container-absolute paths. Rendered as-is, the browser fetches them from the
// web origin and 404s. Rewrite known workspace roots to the authenticated
// agent-files endpoint so the image actually loads.
function WorkspaceFileImg({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  // Resolve the agent's skills root only when this src is a skill `/tmp` path.
  const skillsBasePath = useSkillsBasePath(workspaceId, isSkillTmpPath(src));
  if (workspaceId && src) {
    // Rewrite skill `/tmp` extraction paths onto the workspace drive first, in
    // lockstep with the link parser (see `lib/workspace-file-link.ts`).
    const canonical = canonicalizeAgentPath(src, skillsBasePath);
    let drive: DriveKind | null = null;
    let rawPath: string | null = null;
    if (canonical.startsWith("/workspace/")) {
      drive = "workspace";
      rawPath = canonical.slice("/workspace".length);
    } else if (canonical.startsWith("/mnt/afs/")) {
      drive = "afs";
      rawPath = canonical.slice("/mnt/afs".length);
    }
    if (drive && rawPath) {
      let path: string;
      try {
        path = decodeURIComponent(rawPath);
      } catch {
        path = rawPath;
      }
      return <img {...props} src={fileUrl(workspaceId, path, drive)} alt={alt} />;
    }
  }
  return <img {...props} src={src} alt={alt} />;
}

// Platform-wide convention for auto-emitted system messages: agents (and our
// own code that posts on behalf of the user, e.g. the agent-request resolve
// follow-up) wrap the payload in `<agent-sys>...</agent-sys>`. The tag is
// neutral and cheap on tokens; the renderer below folds it into a labeled
// disclosure so users see "this is an auto message" instead of mistaking it
// for their own input. Plain text inside is rendered as markdown.
const sysSanitizeSchema = {
  ...defaultSchema,
  // `<platform-cmd>` is the docs-side per-OS command switcher (see
  // ./platform-cmd.tsx); its JSON body needs to survive sanitization.
  tagNames: [...(defaultSchema.tagNames ?? []), "agent-sys", "platform-cmd"],
};

// Mirror of Streamdown 1.6's default rehype stack (see
// node_modules/streamdown/dist chunk `Wo`). We override only the sanitize
// schema to whitelist `<agent-sys>`; the rest stays in lockstep with
// Streamdown so katex / raw HTML / link hardening keep working. Revisit on
// Streamdown upgrades.
const defaultRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeKatex, { errorColor: "var(--color-muted-foreground)" }],
  [rehypeSanitize, sysSanitizeSchema],
  [
    harden,
    {
      allowedImagePrefixes: ["*"],
      allowedLinkPrefixes: ["*"],
      allowedProtocols: ["*"],
      defaultOrigin: undefined,
      allowDataImages: true,
    },
  ],
];

function AgentSysBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-md border border-dashed border-foreground/15 bg-muted/20 text-tiny not-prose">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground hover:text-foreground"
      >
        <Sparkles className="h-3 w-3 shrink-0" />
        <span className="font-medium">{t("components.markdown.systemMessage")}</span>
        <ChevronDown
          className={cn("ml-auto h-3 w-3 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-2.5 pb-2 pt-0.5 text-foreground/80">{children}</div>}
    </div>
  );
}

/**
 * Streamdown bundles shiki / mermaid / katex / a stack of remark+rehype
 * plugins — each mount is a 200-500ms tree walk (more with mermaid). We
 * memoize on shallow-equal props so parent re-renders with the same
 * content (react-query refetch returning identical data, layout state
 * changes that rebuild siblings) don't re-pay that cost.
 */
export const Markdown = memo(function Markdown({
  children,
  mode = "static",
  className,
  linkifyWorkspaceFiles = false,
  rehypePlugins,
}: MarkdownProps) {
  const components = useMemo(
    () => ({
      "agent-sys": AgentSysBlock,
      "platform-cmd": PlatformCmd,
      ...(linkifyWorkspaceFiles ? { a: WorkspaceFileLink, img: WorkspaceFileImg } : {}),
    }),
    [linkifyWorkspaceFiles],
  );
  return (
    <Streamdown
      mode={mode}
      className={cn("prose prose-sm dark:prose-invert max-w-none text-[1em]", className)}
      shikiTheme={["github-light", "github-dark"]}
      components={components}
      rehypePlugins={rehypePlugins ?? defaultRehypePlugins}
    >
      {children}
    </Streamdown>
  );
});
