package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestShutdownServer_waitsForWebSocketHandlers(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: http.NotFoundHandler()}

	hubClosed := make(chan struct{})
	srv.RegisterOnShutdown(func() {
		close(hubClosed)
	})

	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		_ = srv.Serve(ln)
	}()
	t.Cleanup(func() {
		_ = srv.Close()
		<-serveDone
	})

	var wsHandlers sync.WaitGroup
	var frameWritten atomic.Bool
	wsHandlers.Add(1)
	go func() {
		defer wsHandlers.Done()
		<-hubClosed
		// Simulate writing the close frame after hub.Close starts.
		time.Sleep(20 * time.Millisecond)
		frameWritten.Store(true)
	}()

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	if err := shutdownServer(ctx, srv, &wsHandlers); err != nil {
		t.Fatalf("shutdownServer() = %v, want nil", err)
	}
	if !frameWritten.Load() {
		t.Error("shutdownServer returned before the WebSocket handler finished")
	}
}

func TestShutdownServer_respectsContextTimeout(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: http.NotFoundHandler()}

	serveDone := make(chan struct{})
	go func() {
		defer close(serveDone)
		_ = srv.Serve(ln)
	}()
	t.Cleanup(func() {
		_ = srv.Close()
		<-serveDone
	})

	var wsHandlers sync.WaitGroup
	release := make(chan struct{})
	wsHandlers.Add(1)
	go func() {
		defer wsHandlers.Done()
		<-release
	}()
	t.Cleanup(func() {
		close(release)
		wsHandlers.Wait()
	})

	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	err = shutdownServer(ctx, srv, &wsHandlers)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("shutdownServer() error = %v, want context.DeadlineExceeded", err)
	}
}
