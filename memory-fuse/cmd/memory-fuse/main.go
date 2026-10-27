// memory-fuse runs as a sidecar in each NAP workspace pod that has at least
// one memory_store attachment. It owns N FUSE mounts under /mnt/memory/<slug>/,
// one per attachment, and exposes a gRPC service at :9102 so cp can push
// live Mount/Unmount/relabel as the user attaches and detaches stores.
//
// Lifecycle:
//
//  1. Read env (CP_URL, WORKSPACE_ID, GRPC_LISTEN_ADDR).
//  2. Pull the initial attachment set from cp via the unauthenticated
//     /internal/workspaces/<id>/memory-attachments endpoint and Mount each,
//     retrying in the background until cp answers.
//  3. Start the gRPC server and wait for SIGTERM/SIGINT.
//  4. On signal: gracefully stop gRPC, then unmount everything.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/neutree-ai/agent-platform/memory-fuse/internal/cache"
	"github.com/neutree-ai/agent-platform/memory-fuse/internal/cpclient"
	"github.com/neutree-ai/agent-platform/memory-fuse/internal/grpcserver"
	"github.com/neutree-ai/agent-platform/memory-fuse/internal/mountmgr"
)

func main() {
	cpURL := os.Getenv("CP_URL")
	workspaceID := os.Getenv("WORKSPACE_ID")
	// Delivered by the runner as a Secret-backed env var. Absent on a pod
	// built before token delivery existed; cp then refuses the calls, and the
	// workspace recovers when it is rebuilt.
	workspaceToken := os.Getenv("WORKSPACE_TOKEN")
	grpcAddr := envOr("GRPC_LISTEN_ADDR", "0.0.0.0:9102")
	mountRoot := envOr("MEMORY_MOUNT_ROOT", "/mnt/memory")
	cacheRoot := envOr("MEMORY_CACHE_ROOT", "/var/cache/memory-fuse")
	debug := os.Getenv("DEBUG") == "true"

	level := slog.LevelInfo
	if debug {
		level = slog.LevelDebug
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level}))

	for _, p := range []struct{ name, val string }{
		{"CP_URL", cpURL},
		{"WORKSPACE_ID", workspaceID},
	} {
		if p.val == "" {
			log.Error("missing required env", "var", p.name)
			os.Exit(2)
		}
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	contentCache, err := cache.New(cacheRoot)
	if err != nil {
		log.Warn("disk cache unavailable; running without it", "root", cacheRoot, "error", err)
	}

	mgr := mountmgr.New(mountmgr.Options{
		CPURL:       cpURL,
		WorkspaceID: workspaceID,
		Token:       workspaceToken,
		MountRoot:   mountRoot,
		Cache:       contentCache,
		Logger:      log,
	})

	// cp can be unreachable while the pod boots (cp restarting, a node coming
	// back before its service routing is ready). cp only pushes mounts on
	// attach/detach, so a pull that never succeeds leaves the workspace with
	// no mounts until the pod is rebuilt — keep retrying in the background
	// while gRPC serves. Mount is idempotent, so a push that lands first is
	// harmless.
	go retryUntilSuccess(ctx, log, time.Second, 30*time.Second, func(ctx context.Context) error {
		return bootPull(ctx, log, cpURL, workspaceID, workspaceToken, mgr, contentCache)
	})

	srv := grpcserver.New(mgr, log)
	go func() {
		if err := srv.Serve(ctx, grpcAddr); err != nil {
			log.Error("grpc serve failed", "error", err)
			cancel()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	mgr.Close()
	log.Info("exited")
}

// retryUntilSuccess runs fn until it returns nil or ctx is done, doubling the
// wait between attempts from initial up to maxDelay.
func retryUntilSuccess(
	ctx context.Context,
	log *slog.Logger,
	initial, maxDelay time.Duration,
	fn func(context.Context) error,
) {
	delay := initial
	for attempt := 1; ; attempt++ {
		err := fn(ctx)
		if err == nil {
			return
		}
		if ctx.Err() != nil {
			return
		}
		log.Warn("boot pull failed; retrying", "attempt", attempt, "retry_in", delay, "error", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		delay = min(delay*2, maxDelay)
	}
}

func bootPull(
	ctx context.Context,
	log *slog.Logger,
	cpURL, workspaceID, token string,
	mgr *mountmgr.Manager,
	contentCache *cache.Cache,
) error {
	pullCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	atts, err := cpclient.ListWorkspaceAttachments(pullCtx, cpURL, workspaceID, token)
	if err != nil {
		return err
	}
	log.Info("boot pull", "workspace_id", workspaceID, "attachments", len(atts))
	// Prune cache directories that no longer correspond to any attachment —
	// happens when the daemon was down while the user detached a store.
	if contentCache != nil {
		keep := make([]string, 0, len(atts))
		for _, a := range atts {
			keep = append(keep, a.StoreID)
		}
		if err := contentCache.PruneExcept(keep); err != nil {
			log.Warn("cache prune failed", "error", err)
		}
	}
	for _, a := range atts {
		if _, err := mgr.Mount(ctx, a.StoreID, a.Access == "read_only"); err != nil {
			log.Error("boot mount failed", "store_id", a.StoreID, "error", err)
		}
	}
	return nil
}

func envOr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}
