// Package grpcserver bridges the MemoryFuseService proto to mountmgr.
// One server listens at GRPC_LISTEN_ADDR (typically 0.0.0.0:9102) and is
// reached by cp via the workspace's k8s Service.
package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/neutree-ai/agent-platform/memory-fuse/internal/mountmgr"
	pb "github.com/neutree-ai/agent-platform/memory-fuse/internal/proto/memoryfuse"
)

type Server struct {
	pb.UnimplementedMemoryFuseServiceServer
	mgr *mountmgr.Manager
	log *slog.Logger
}

func New(mgr *mountmgr.Manager, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{mgr: mgr, log: log}
}

// Serve blocks until ctx is cancelled. Closes the listener and gracefully
// stops the gRPC server on ctx done.
func (s *Server) Serve(ctx context.Context, addr string) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}
	gs := grpc.NewServer()
	pb.RegisterMemoryFuseServiceServer(gs, s)

	errCh := make(chan error, 1)
	go func() {
		s.log.Info("grpc serving", "addr", addr)
		errCh <- gs.Serve(lis)
	}()

	select {
	case <-ctx.Done():
		s.log.Info("grpc stopping")
		gs.GracefulStop()
		return nil
	case err := <-errCh:
		return err
	}
}

func (s *Server) Mount(ctx context.Context, req *pb.MountRequest) (*pb.MountResponse, error) {
	if req.GetStoreId() == "" {
		return nil, status.Error(codes.InvalidArgument, "store_id is required")
	}
	mp, err := s.mgr.Mount(ctx, req.GetStoreId(), req.GetReadOnly())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "mount: %v", err)
	}
	return &pb.MountResponse{Mountpoint: mp}, nil
}

func (s *Server) Unmount(_ context.Context, req *pb.UnmountRequest) (*pb.UnmountResponse, error) {
	if req.GetStoreId() == "" {
		return nil, status.Error(codes.InvalidArgument, "store_id is required")
	}
	if err := s.mgr.Unmount(req.GetStoreId()); err != nil {
		return nil, status.Errorf(codes.Internal, "unmount: %v", err)
	}
	return &pb.UnmountResponse{}, nil
}

func (s *Server) Invalidate(_ context.Context, req *pb.InvalidateRequest) (*pb.InvalidateResponse, error) {
	if req.GetStoreId() == "" {
		return nil, status.Error(codes.InvalidArgument, "store_id is required")
	}
	if err := s.mgr.Invalidate(req.GetStoreId()); err != nil {
		return nil, status.Errorf(codes.Internal, "invalidate: %v", err)
	}
	return &pb.InvalidateResponse{}, nil
}

func (s *Server) ListMounts(_ context.Context, _ *pb.ListMountsRequest) (*pb.ListMountsResponse, error) {
	infos := s.mgr.List()
	out := &pb.ListMountsResponse{Mounts: make([]*pb.MountInfo, 0, len(infos))}
	for _, i := range infos {
		out.Mounts = append(out.Mounts, &pb.MountInfo{
			StoreId:    i.StoreID,
			Mountpoint: i.Mountpoint,
			ReadOnly:   i.ReadOnly,
		})
	}
	return out, nil
}
