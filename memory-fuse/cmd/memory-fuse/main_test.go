package main

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"
)

var discardLog = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestRetryUntilSuccessRetriesThenStops(t *testing.T) {
	calls := 0
	retryUntilSuccess(context.Background(), discardLog, time.Millisecond, 4*time.Millisecond,
		func(context.Context) error {
			calls++
			if calls < 4 {
				return errors.New("connection refused")
			}
			return nil
		})
	if calls != 4 {
		t.Fatalf("calls = %d, want 4", calls)
	}
}

func TestRetryUntilSuccessStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		retryUntilSuccess(ctx, discardLog, time.Millisecond, time.Millisecond,
			func(context.Context) error { return errors.New("connection refused") })
		close(done)
	}()
	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("retry loop did not stop after cancel")
	}
}
