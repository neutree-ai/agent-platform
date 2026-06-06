# skills-content-service

Data-plane service for the NAP skills bounded context. Owns every read and
write of the `skills.package` BYTEA column; control-plane keeps the metadata
columns and the user-facing ACL.

## Why a separate service

`skills.package` is a `BYTEA` tar.gz blob. Two pressures argued for moving
binary IO off cp:

- **Library / preview / agent stamping** need to browse and download skill
  contents file-by-file. Hosting the unpack-and-serve path in cp would either
  bloat its memory (in-process cache) or push every file read through cp's
  request loop (no cache). A dedicated service gets a pod-local cache and
  serves files via embedded dufs.
- **Upload / re-upload / git-import / agent publish** each materialized the
  full tarball in cp memory before INSERTing it. Multiple cp replicas all
  paying that cost for routes that mostly proxy bytes is wasteful. p1.5 moves
  the BYTEA writes here too: cp streams the request body straight through,
  scs collects it once and writes pg.

## Status

Phase 1 (content basis) is complete:

- ✅ Hono + OpenAPIHono skeleton, `/health`
- ✅ esbuild bundle, Dockerfile (with dufs binary), k8s manifest (NFS PVC
     cache), rollout wired
- ✅ Reads `skills` directly from pg via shared connection
- ✅ Cache version key is `content_hash` — a `GENERATED ALWAYS AS
     (encode(digest(package,'sha256'),'hex')) STORED` column added by
     migration 102. Idempotent re-uploads reuse the existing unpack dir.
- ✅ Unpack into `<CACHE_DIR>/<name>/<content_hash>/` via tmp-dir + atomic
     `rename(2)`; in-process singleflight via `Map<key, Promise>`. Per-entry
     extraction streams `tar-stream → createWriteStream` (no `Buffer.concat`
     accumulation).
- ✅ Local dufs sidecar serves the cache root (loopback, read-only). Node
     proxies version-resolved URLs to it.
- ✅ Read endpoints:
  - `GET /skills/:name/package` — raw tar.gz (used by agent stamping and the
    user download surface; cp proxies through)
  - `GET /skills/:name/files?path=...`
  - `GET /skills/:name/dirs?path=...&q=...`
  - `GET /skills/:name/dirs/zip?path=...`
- ✅ Write endpoints (cp resolves ACL and forwards body streams):
  - `POST /skills?name=…&description=…&visibility=…&user_id=…` — upsert,
    body is the tarball, optional `X-Skill-Git-Source` header
  - `PUT /skills/:name/package` — replace just the bytes
- ✅ LRU eviction sweep — periodic, evicts by `.access` mtime when total
     bytes cross `CACHE_HIGH_WATER_BYTES`; per-skill cap on retained version
     dirs; reaps orphan `.tmp-*` and orphan-skill subtrees (rows that were
     deleted from pg).

Pending in phase 1: scan-preview + git-import endpoints (so cp can stop
calling git-source-client too). Tracked as p1.5-C.

## fs API contract

The read route shape (`files`, `dirs`, `dirs/zip` + `path=` query)
deliberately mirrors `/api/workspaces/:id/agent/{files,dirs,dirs/zip}` so
the frontend can add a `DriveKind: 'skill'` to `agent-files.ts` and reuse
the existing file-browser code unchanged.

Internally both surfaces sit on dufs — workspace via the agent pod's dufs,
skills via this service's embedded dufs. The protocol on the wire (JSON
listing shape, zip archive, content-type headers) is identical.

## Cache durability vs §4.1

The cache lives on an NFS PVC (10Gi, RWO, single replica) — persistent
across pod restarts to keep hit-rate high. This still satisfies §4.1:
nothing authoritative lives here. Every entry can be rebuilt from
`skills.package` in pg; losing the volume only spikes cold-miss for a
while.

The single-replica + RWO choice is deliberate. Going to multiple replicas
would need RWX + cross-process singleflight + leader-elected GC, which is
a larger rework. Defer until we actually need horizontal capacity.

## Auth

Internal-network only. cp does the user-facing authz check and forwards
requests; scs trusts the cluster network boundary. No agent or browser
talks to scs directly today.

## Local dev

```bash
cd skills-content-service   # from the repo root
npm install
cp .env.example .env
npm run dev
curl http://localhost:3008/health
```
