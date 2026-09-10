package jobs

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestReadConcurrencyIsBounded(t *testing.T) {
	const limit = 2
	l := newExecutionLimiter(limit)
	ctx := context.Background()
	var active atomic.Int32
	var peak atomic.Int32
	release := make(chan struct{})
	done := make(chan struct{}, limit)

	for i := 0; i < limit; i++ {
		if !l.acquireRead(ctx) {
			t.Fatal("read acquisition unexpectedly cancelled")
		}
		go func() {
			current := active.Add(1)
			for old := peak.Load(); current > old && !peak.CompareAndSwap(old, current); old = peak.Load() {
			}
			<-release
			active.Add(-1)
			l.releaseRead()
			done <- struct{}{}
		}()
	}

	thirdAcquired := make(chan bool, 1)
	go func() { thirdAcquired <- l.acquireRead(ctx) }()
	select {
	case <-thirdAcquired:
		t.Fatal("read concurrency exceeded configured limit")
	case <-time.After(25 * time.Millisecond):
	}

	close(release)
	for i := 0; i < limit; i++ {
		<-done
	}
	select {
	case ok := <-thirdAcquired:
		if !ok {
			t.Fatal("waiting read did not acquire after capacity became available")
		}
		l.releaseRead()
	case <-time.After(time.Second):
		t.Fatal("waiting read remained blocked")
	}
	if got := peak.Load(); got > limit {
		t.Fatalf("peak reads = %d, want <= %d", got, limit)
	}
}

func TestMutationsAreSerialized(t *testing.T) {
	l := newExecutionLimiter(1)
	if !l.acquireMutation(context.Background()) {
		t.Fatal("first mutation acquisition failed")
	}
	if !l.mutationIsBusy() {
		t.Fatal("mutation should be reported busy while held")
	}

	second := make(chan bool, 1)
	go func() { second <- l.acquireMutation(context.Background()) }()
	select {
	case <-second:
		t.Fatal("second mutation ran concurrently")
	case <-time.After(25 * time.Millisecond):
	}
	l.releaseMutation()
	select {
	case ok := <-second:
		if !ok {
			t.Fatal("second mutation acquisition was cancelled")
		}
		l.releaseMutation()
	case <-time.After(time.Second):
		t.Fatal("second mutation remained blocked")
	}
}

func TestCancelledWaitDoesNotDeadlock(t *testing.T) {
	l := newExecutionLimiter(1)
	if !l.acquireRead(context.Background()) {
		t.Fatal("initial read acquisition failed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if l.acquireRead(ctx) {
		t.Fatal("cancelled read acquisition unexpectedly succeeded")
	}
	l.releaseRead()
}

func TestReadOnlyClassification(t *testing.T) {
	for _, jobType := range []string{"MOD_LIST", "MOD_QUARANTINE_LIST", "MOD_PENDING_LIST", "MOD_CONFIG_READ", "SERVER_CONFIG_READ", "PLAYER_LIST_SYNC", "PLAYER_ADMIN_LIST", "SAVE_LIST", "ITEM_CATALOG"} {
		if !isReadOnly(jobType) {
			t.Errorf("%s should be read-only", jobType)
		}
	}
	for _, jobType := range []string{"RCON", "SEND_COMMAND", "SERVER_RESTART", "PLAYER_KICK", "MOD_DELETE"} {
		if isReadOnly(jobType) {
			t.Errorf("%s must be serialized", jobType)
		}
	}
}

func TestPollWaitHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	if waitForPoll(ctx, time.Minute) {
		t.Fatal("cancelled poll wait reported success")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("cancelled poll wait took too long: %s", elapsed)
	}
}
