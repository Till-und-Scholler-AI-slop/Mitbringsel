package cleanup

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// countingTask counts its runs. atomic, because Run calls it from another
// goroutine than the test reads it from (the race detector would complain).
func countingTask(name string, runs *atomic.Int64, err error) Task {
	return Task{Name: name, Run: func(context.Context) (int64, error) {
		runs.Add(1)
		return 1, err
	}}
}

// runInBackground starts Run and returns a function that stops it and
// waits until it has returned.
func runInBackground(t *testing.T, interval time.Duration, tasks []Task) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		Run(ctx, interval, tasks)
	}()
	return func() {
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("Run did not return after the context was cancelled")
		}
	}
}

// waitFor polls until cond holds, so the tests need no fixed sleeps.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestRunStartsAtOnce(t *testing.T) {
	var runs atomic.Int64
	// An interval the test never reaches: only the first round counts.
	stop := runInBackground(t, time.Hour, []Task{countingTask("a", &runs, nil)})
	defer stop()

	waitFor(t, "the first run", func() bool { return runs.Load() == 1 })
}

func TestRunRepeatsEveryInterval(t *testing.T) {
	var runs atomic.Int64
	stop := runInBackground(t, 5*time.Millisecond, []Task{countingTask("a", &runs, nil)})
	defer stop()

	waitFor(t, "three runs", func() bool { return runs.Load() >= 3 })
}

func TestRunKeepsGoingAfterAFailure(t *testing.T) {
	var failing, other atomic.Int64
	stop := runInBackground(t, 5*time.Millisecond, []Task{
		countingTask("failing", &failing, errors.New("database down")),
		countingTask("other", &other, nil),
	})
	defer stop()

	// The task after the failing one runs, and the failing one is tried again.
	waitFor(t, "both tasks twice", func() bool { return failing.Load() >= 2 && other.Load() >= 2 })
}

func TestRunStopsWhenCancelled(t *testing.T) {
	var runs atomic.Int64
	stop := runInBackground(t, 5*time.Millisecond, []Task{countingTask("a", &runs, nil)})
	waitFor(t, "the first run", func() bool { return runs.Load() >= 1 })

	stop()
	after := runs.Load()
	time.Sleep(20 * time.Millisecond)

	if runs.Load() != after {
		t.Errorf("tasks ran %d more times after Run returned", runs.Load()-after)
	}
}

func TestRunSkipsTheRestOnceCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var second atomic.Int64
	tasks := []Task{
		// The first task notices the shutdown in its query and fails.
		{Name: "first", Run: func(context.Context) (int64, error) {
			cancel()
			return 0, context.Canceled
		}},
		countingTask("second", &second, nil),
	}

	Run(ctx, time.Hour, tasks)

	if second.Load() != 0 {
		t.Error("a task ran after the context was cancelled")
	}
}
