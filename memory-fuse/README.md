# memory-fuse

A FUSE daemon that mounts a NAP memory store as a directory tree backed by
the control-plane REST API. Memories are flat path-keyed records on the
server; this daemon synthesises the directory hierarchy on the fly so
agents (and humans) can `ls`, `cat`, and (in P3) edit memories with
ordinary file-system tools.

## Status

- **P2**: read-only — list, read, lazy fetch with sha-keyed cache,
  periodic snapshot refresh.
- **P3** (current): write path — `create`, `write`, `truncate`, `unlink`
  buffered locally and committed on `flush(2)` with sha-256 precondition.
  412 conflicts surface to the caller as `EIO` after dropping the local
  view; next read sees the server's copy.
- **P4**: sidecar injection into workspace pods.

## Build

```sh
cd memory-fuse
go build ./cmd/memory-fuse        # local
GOOS=linux go build ./cmd/memory-fuse
docker build -t memory-fuse .     # for sidecar / dev container
```

## Run (local dev)

```sh
mkdir -p /tmp/mem
./memory-fuse \
    --cp-url https://nap.example.com \
    --store-id <store-id> \
    --token "$NAP_TOKEN" \
    --mount /tmp/mem
```

The daemon stays in the foreground and unmounts on `SIGINT` / `SIGTERM`.

```sh
ls /tmp/mem                            # synthesised directory tree
cat /tmp/mem/notes/foo.md              # read
echo "hello" > /tmp/mem/notes/foo.md   # write — committed on close(2)
rm /tmp/mem/notes/foo.md               # delete
```

### Flags

| Flag | Default | Notes |
| --- | --- | --- |
| `--cp-url` | `$CP_URL` | Control-plane base URL (required) |
| `--store-id` | (required) | Memory store id |
| `--mount` | (required) | Mount point directory |
| `--token` | `$MEMORY_FUSE_TOKEN` | Bearer token |
| `--refresh-ms` | `30000` | Snapshot poll interval |
| `--debug` | `false` | Verbose FUSE logging |

## Docker

```sh
docker run --rm --device /dev/fuse --cap-add SYS_ADMIN \
    -v /tmp/mem:/mnt/mem:rshared \
    -e MEMORY_FUSE_TOKEN=$NAP_TOKEN \
    memory-fuse \
    --cp-url https://nap.example.com \
    --store-id <store-id> \
    --mount /mnt/mem
```

## Design

`internal/cpclient` is a thin HTTP client for the four endpoints we use
(`GET memories`, `GET/PUT/DELETE memory/<path>`). `internal/memfs` keeps
an in-memory snapshot of `MemoryLite` records, refreshes it on a ticker,
and lazily fetches `content` on first read — keyed by sha so the kernel
only sees fresh bytes after a remote update. Direct-IO is enabled so
reads always hit `Read` (no kernel page cache).

The directory tree is synthesised from flat path strings: every prefix
becomes a directory; the leaf is the file. Empty directories have no
backing in the flat store, so `mkdir` creates them *ephemerally* in daemon
memory — they persist until a memory lands under them (graduating to a real
synthesised dir) or the daemon restarts. `mv`/rename is backed by an atomic
cp move endpoint (`POST .../memory-move`) that preserves the memory's
identity instead of emulating rename as a non-atomic PUT+DELETE.

This is a restricted filesystem, not full POSIX. See
[`KNOWN-SEMANTICS.md`](./KNOWN-SEMANTICS.md) for exactly what is supported,
what fails, and the editor/atomic-save caveats.
