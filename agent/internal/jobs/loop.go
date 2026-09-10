package jobs

import (
	"context"
	"log/slog"
	"os"
	"sync/atomic"
	"time"

	"github.com/mastermind/agent/internal/agent"
	"github.com/mastermind/agent/internal/backoff"
	"github.com/mastermind/agent/internal/client"
	"github.com/mastermind/agent/internal/metrics"
)

// Loop polls for jobs and executes them via the given JobExecutor until ctx is
// cancelled. The optional concurrency argument preserves compatibility with
// older callers; when absent or invalid, eight concurrent reads are allowed.
func Loop(ctx context.Context, c client.Client, hostID string, pollIntervalSec int, longPollSec int, exec agent.JobExecutor, maxConcurrentReads ...int) {
	readLimit := 8
	if len(maxConcurrentReads) > 0 && maxConcurrentReads[0] > 0 {
		readLimit = maxConcurrentReads[0]
	}
	limiter := newExecutionLimiter(readLimit)
	retryCfg := backoff.Config{Maximum: 30 * time.Second}
	if pollIntervalSec > 0 {
		retryCfg.Initial = time.Duration(pollIntervalSec) * time.Second
	}
	pollRetry := backoff.New(retryCfg)
	for {
		jobs, err := c.PollJobs(ctx, hostID, longPollSec, limiter.mutationIsBusy())
		if err != nil {
			metrics.PollFailed()
			slog.Warn("poll jobs failed", "err", err)
			if err := pollRetry.Wait(ctx); err != nil {
				return
			}
			continue
		}
		pollRetry.Reset()
		if len(jobs) == 0 {
			// When long-poll already blocked, poll again immediately. Only sleep
			// if the control plane returned empty without waiting.
			if longPollSec > 0 {
				continue
			}
			if !waitForPoll(ctx, time.Duration(pollIntervalSec)*time.Second) {
				return
			}
			continue
		}
		for _, j := range jobs {
			if isReadOnly(j.Type) {
				if !limiter.acquireRead(ctx) {
					return
				}
				go func(job client.Job) {
					defer limiter.releaseRead()
					runOne(ctx, c, hostID, job, exec)
				}(j)
			} else {
				// The control plane removes a job from Redis and marks it running as
				// soon as poll returns it. Keeping a second in-memory mutation queue
				// let polling claim dozens of jobs while one long restart was active.
				// If the agent restarted, every claimed job behind it was lost forever.
				// Execute mutations before polling again: durable queue remains the
				// sole backlog and the UI only says running for work truly executing.
				if !limiter.acquireMutation(ctx) {
					return
				}
				go func(job client.Job) {
					defer limiter.releaseMutation()
					runOne(ctx, c, hostID, job, exec)
				}(j)
			}
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
	}
}

func waitForPoll(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		delay = time.Second
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return true
	case <-ctx.Done():
		return false
	}
}

// executionLimiter bounds read work without creating a goroutine per queued
// job, and uses a one-slot gate for all mutations. Acquiring in the poll loop
// applies backpressure to an unexpectedly large dispatch batch and makes
// cancellation unblock cleanly.
type executionLimiter struct {
	reads        chan struct{}
	mutation     chan struct{}
	mutationBusy atomic.Bool
}

func newExecutionLimiter(maxConcurrentReads int) *executionLimiter {
	if maxConcurrentReads <= 0 {
		maxConcurrentReads = 8
	}
	l := &executionLimiter{
		reads:    make(chan struct{}, maxConcurrentReads),
		mutation: make(chan struct{}, 1),
	}
	l.mutation <- struct{}{}
	return l
}

func (l *executionLimiter) acquireRead(ctx context.Context) bool {
	metrics.ReadQueued(1)
	defer metrics.ReadQueued(-1)
	select {
	case l.reads <- struct{}{}:
		metrics.ReadActive(1)
		return true
	case <-ctx.Done():
		return false
	}
}

func (l *executionLimiter) releaseRead() {
	<-l.reads
	metrics.ReadActive(-1)
}

func (l *executionLimiter) acquireMutation(ctx context.Context) bool {
	metrics.MutationQueued(1)
	defer metrics.MutationQueued(-1)
	select {
	case <-l.mutation:
		l.mutationBusy.Store(true)
		return true
	case <-ctx.Done():
		return false
	}
}

func (l *executionLimiter) releaseMutation() {
	l.mutationBusy.Store(false)
	l.mutation <- struct{}{}
}

func (l *executionLimiter) mutationIsBusy() bool { return l.mutationBusy.Load() }

// Only explicitly audited inventory/query jobs may run concurrently. RCON and
// SEND_COMMAND are deliberately absent: arbitrary console commands can mutate
// game state and therefore must pass through the serialized mutation gate.
func isReadOnly(jobType string) bool {
	switch jobType {
	case "MOD_LIST", "MOD_QUARANTINE_LIST", "MOD_PENDING_LIST", "MOD_CONFIG_READ", "SERVER_CONFIG_READ", "PLAYER_LIST_SYNC", "PLAYER_ADMIN_LIST", "SAVE_LIST", "ITEM_CATALOG":
		return true
	default:
		return false
	}
}

func runOne(ctx context.Context, c client.Client, hostID string, j client.Job, exec agent.JobExecutor) {
	started := time.Now()
	succeeded := false
	defer func() {
		if succeeded {
			metrics.JobCompleted()
		} else {
			metrics.JobFailed()
		}
	}()
	maxDuration := 15 * time.Minute
	if j.Type == "SERVER_SAFE_RESTART" || j.Type == "SERVER_RESTART" || j.Type == "SERVER_SAVE_STOP" || j.Type == "SERVER_MAINTENANCE" || j.Type == "SERVER_UPDATE" {
		maxDuration = 24 * time.Hour
	} else if isReadOnly(j.Type) {
		maxDuration = 3 * time.Minute
	}
	execCtx, cancel := context.WithTimeout(ctx, maxDuration)
	defer cancel()
	jobCtx := agent.WithProgressReporter(execCtx, func(phase, message string) {
		if err := c.SubmitJobProgress(ctx, hostID, j.ID, phase, message); err != nil {
			slog.Warn("report job progress failed", "jobRunId", j.ID, "err", err)
		}
	})
	var downloadedArchive string
	if j.Type == "MOD_UPLOAD_QUARANTINE" || j.Type == "MOD_UPLOAD_PENDING" {
		_ = c.SubmitJobProgress(ctx, hostID, j.ID, "downloading", "Downloading uploaded mod archive")
		temporary, err := os.CreateTemp("", "mastermind-mod-upload-*.zip")
		if err != nil {
			_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{Status: "failed", ErrorMessage: "create temporary archive: " + err.Error()})
			return
		}
		downloadedArchive = temporary.Name()
		if err := c.DownloadJobFile(execCtx, hostID, j.ID, temporary); err != nil {
			_ = temporary.Close()
			_ = os.Remove(downloadedArchive)
			_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{Status: "failed", ErrorMessage: err.Error()})
			return
		}
		if err := temporary.Sync(); err != nil {
			_ = temporary.Close()
			_ = os.Remove(downloadedArchive)
			_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{Status: "failed", ErrorMessage: "sync temporary archive: " + err.Error()})
			return
		}
		if err := temporary.Close(); err != nil {
			_ = os.Remove(downloadedArchive)
			_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{Status: "failed", ErrorMessage: "close temporary archive: " + err.Error()})
			return
		}
		defer os.Remove(downloadedArchive)
		if j.Payload == nil {
			j.Payload = map[string]interface{}{}
		}
		j.Payload["archive_path"] = downloadedArchive
	}
	slog.Info("job started", "jobRunId", j.ID, "type", j.Type)
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				_ = c.SubmitJobProgress(ctx, hostID, j.ID, "running", "Agent is executing this job")
			}
		}
	}()
	job := agent.Job{
		ID:               j.ID,
		Type:             j.Type,
		ServerInstanceID: j.ServerInstanceID,
		Payload:          j.Payload,
		ScheduleID:       j.ScheduleID,
	}
	result, err := exec.Execute(jobCtx, job)
	close(done)
	slog.Info("job finished", "jobRunId", j.ID, "type", j.Type, "duration", time.Since(started), "error", err)
	if err != nil {
		_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{
			Status:       "failed",
			ErrorMessage: err.Error(),
			DurationMs:   time.Since(started).Milliseconds(),
		})
		return
	}
	errorMessage := result.Error
	if result.Result != nil {
		if errValue, ok := result.Result["error"].(string); ok && errorMessage == "" {
			errorMessage = errValue
		}
	}
	_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{
		Status:       result.Status,
		Output:       result.Output,
		Result:       result.Result,
		ErrorMessage: errorMessage,
		DurationMs:   time.Since(started).Milliseconds(),
	})
	succeeded = result.Status != "failed"
}
