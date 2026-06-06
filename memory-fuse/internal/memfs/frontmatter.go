package memfs

import (
	"errors"
	"strings"
)

// indexFileName is the per-store agent-maintained index. It carries no
// frontmatter and is the only path the validator skips.
const indexFileName = "/MEMORY.md"

var validTypes = map[string]bool{
	"user":      true,
	"feedback":  true,
	"project":   true,
	"reference": true,
}

// validateMemoryContent enforces the on-disk schema documented in the
// platform skill's reference/memory.md at flush time. We keep the check
// narrow on purpose:
//
//   - must open with `---\n` and close with `\n---\n` (or `\n---` at EOF)
//   - the YAML block must contain a non-empty `name:` line
//   - it must contain a `metadata:` block with a `type:` whose value is one
//     of the four documented enums
//
// Description and created date are documented as required but tolerated as
// missing here — Reflect can backfill those, but an unparseable type or a
// missing name leaves consolidation no anchor.
//
// MEMORY.md is exempt; it is the index, not a memory.
func validateMemoryContent(path string, body []byte) error {
	if path == indexFileName {
		return nil
	}
	text := string(body)
	if !strings.HasPrefix(text, "---\n") {
		return errors.New("missing frontmatter (file must open with `---`)")
	}
	rest := text[4:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return errors.New("unterminated frontmatter (missing closing `---`)")
	}
	yaml := rest[:end]

	var name, mtype string
	inMetadata := false
	for _, line := range strings.Split(yaml, "\n") {
		switch {
		case strings.HasPrefix(line, "name:"):
			name = strings.TrimSpace(strings.TrimPrefix(line, "name:"))
			inMetadata = false
		case strings.HasPrefix(line, "metadata:"):
			inMetadata = true
		case inMetadata && strings.HasPrefix(strings.TrimSpace(line), "type:"):
			mtype = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "type:"))
		case len(line) > 0 && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t"):
			inMetadata = false
		}
	}

	if name == "" {
		return errors.New("frontmatter `name:` is required and must be non-empty")
	}
	if mtype == "" {
		return errors.New("frontmatter `metadata.type:` is required")
	}
	if !validTypes[mtype] {
		return errors.New("frontmatter `metadata.type:` must be one of user, feedback, project, reference")
	}
	return nil
}
