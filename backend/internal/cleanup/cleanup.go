// Package cleanup runs the periodic jobs that delete data nobody needs any
// more: expired sessions and old invites now, tombstones and processed
// operations in phase 6. It knows nothing about what a task deletes.
package cleanup

import (
	"context"
	"log/slog"
	"time"
)

// DefaultInterval is how often the server runs the tasks. The tables are
// small, and nothing waits for a cleanup: once an hour is plenty.
const DefaultInterval = time.Hour

// Task is one cleanup job. Run deletes what is due and returns how many rows
// it deleted. A task must be safe to run again at any time, also by two
// server processes at once: deleting what is gone already does nothing.
type Task struct {
	Name string
	Run  func(ctx context.Context) (int64, error)
}

// Run runs every task once right away and then every interval, until ctx is
// cancelled. It blocks, so the caller starts it in a goroutine of its own.
// A failing task is logged and tried again next time; it does not stop the
// others.
func Run(ctx context.Context, interval time.Duration, tasks []Task) {
	// A ticker sends on its channel C every interval. Stop releases it;
	// defer runs that when Run returns, however it returns.
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		runAll(ctx, tasks)
		// select waits for whichever channel is ready first: the end of
		// the server (ctx.Done is closed on shutdown) or the next tick.
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runAll(ctx context.Context, tasks []Task) {
	for _, task := range tasks {
		// Shutting down: the rest can wait for the next start.
		if ctx.Err() != nil {
			return
		}
		deleted, err := task.Run(ctx)
		switch {
		case err != nil && ctx.Err() != nil:
			// Cancelled in the middle of the query; not a failure.
			return
		case err != nil:
			slog.Error("cleanup failed", "task", task.Name, "error", err)
		case deleted > 0:
			slog.Info("cleanup", "task", task.Name, "deleted", deleted)
		}
	}
}
