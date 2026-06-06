# memory-fuse — supported filesystem semantics

The mount at `/mnt/memory/<store>/` is **not a full POSIX filesystem**. It is a
view over a flat, path-keyed memory store on the control-plane, so anything that
depends on native directory objects, links, or rich metadata is either emulated
or unsupported. This file is the contract: if a tool fails here, check this list
before assuming a bug.

## Supported

| Operation | Notes |
| --- | --- |
| `ls`, `cat`, `stat` | Tree is synthesised from memory paths. |
| `echo > f`, `>>`, in-place write | Create/Write/Truncate buffered, committed on `close(2)`. |
| `rm` | Unlink → server delete (sha precondition). |
| `mkdir`, `mkdir -p` | **Ephemeral**: empty dirs live in daemon memory until a memory lands under them or the daemon restarts (the backend has no empty-dir concept). |
| `rmdir` | Only empty *ephemeral* dirs. A dir backed by memories is non-empty → `ENOTEMPTY`. |
| `mv` / rename(2) | **Files only**, via the cp atomic move endpoint — preserves the memory's id/created_at/history. Overwrite (replace destination) is supported; this is what makes editor "write temp → rename over target" atomic saves work. |
| `fsync` / `fdatasync` | Commits the buffer (same path as close). |
| `df` / statfs | Reports a synthetic large, mostly-free volume (no real block accounting). |

## Unsupported — hard failures

| Operation | Errno | Why |
| --- | --- | --- |
| Directory rename (`mv dir1 dir2`) | `EXDEV` | Would be a prefix bulk-move; userspace falls back to recursive copy+unlink. |
| rename `RENAME_EXCHANGE` | `ENOSYS` | No atomic two-path swap. |
| Symlink / hardlink (`ln`, `ln -s`) | `ENOSYS` | No link concept in the store. |
| `mknod` / `mkfifo` | `ENOSYS` | No special files. |
| xattr (`getfattr`/`setfattr`, SELinux, macOS) | `ENOTSUP` | No xattr storage. |
| `flock` / `fcntl` locks | no-op | No lock manager; concurrent writers are arbitrated only by the sha precondition on commit (loser gets `EIO`). |
| `fallocate` | `ENOSYS` | No preallocation. |

## Unsupported — silently accepted (no-op)

`chmod`, `chown`, and timestamp changes (`touch -t`, utimes) **return success but
do nothing**. Files are always reported as `root:root`, mode `0644` (files) /
`0755` (dirs). There is no permission model on a memory store.

## Gotchas

- **Content is validated on commit.** Every file write must carry valid
  frontmatter (`---` block with non-empty `name:` and a `metadata.type:` of
  `user|feedback|project|reference`); otherwise `close(2)` fails with `EINVAL`.
  `MEMORY.md` is exempt (it's the index). See `internal/memfs/frontmatter.go`.
- **vim and other probe-heavy editors may still struggle.** rename(2) support
  fixes the *atomic-save* pattern (write a complete temp file, rename it over the
  target) — which covers `sed -i`, most save libraries, and `mv` itself. But
  editors that first write an *empty* probe file (vim's `4913`) to test
  writability will trip the frontmatter validator (`EINVAL`) on that probe before
  they ever get to the rename. Prefer editing via tools that write the full file.
- **rename is last-writer-wins on the move itself.** The move carries no sha
  precondition, so it always moves whatever is currently at the source path.
- **`touch x && mv x y` fails** if `x` was never written: `touch` creates an
  in-memory node with no server row, and the move has nothing to move (`ENOENT`).
  Write content before renaming.
- **Ephemeral dirs evaporate on daemon restart.** A `mkdir`'d dir with no memory
  under it is not durable — it exists only to let you stage a write into it
  during the same session.
</content>
