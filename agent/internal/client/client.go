package client

import (
	"context"
	"io"
	"time"
)

// Client talks to the control plane (pairing, heartbeat, jobs, log upload).
// Auth: after pairing, use the stored agent key in Authorization header.
type Client interface {
	// Pair exchanges pairingToken for a signed agent key. On success, caller stores key at agentKeyPath.
	Pair(ctx context.Context, pairingToken string, hostMetadata *HostMetadata) (*PairResponse, error)
	// Heartbeat sends host id + metadata. Uses stored key for auth.
	Heartbeat(ctx context.Context, hostID string, meta *HostMetadata) error
	// SyncDiscoveredServer sends locally discovered game server data to the control plane.
	// Returns the upserted server instance id when the control plane provides one.
	SyncDiscoveredServer(ctx context.Context, hostID string, gameType string, server *DiscoveredServer) (string, error)
	// PollJobs long-polls or short-polls for jobs for this host. Returns when at least one job is ready or timeout.
	PollJobs(ctx context.Context, hostID string, longPollSec int, mutationBusy bool) ([]Job, error)
	// DownloadJobFile streams a binary artifact assigned to a job without loading it into the JSON queue.
	DownloadJobFile(ctx context.Context, hostID string, jobID string, destination io.Writer) error
	// SubmitJobResult sends the result of a job run.
	SubmitJobResult(ctx context.Context, hostID string, jobID string, result *JobResultPayload) error
	// SubmitJobProgress reports a nonterminal display phase without completing the run.
	SubmitJobProgress(ctx context.Context, hostID string, jobID string, phase string, message string) error
	// StreamLog uploads log chunks (e.g. multipart or chunked body). Optional for MVP.
	StreamLog(ctx context.Context, hostID string, serverInstanceID string, r io.Reader) error
}

// HostMetadata is sent at pairing and on each heartbeat.
type HostMetadata struct {
	Name          string    `json:"name,omitempty"`
	CPU           string    `json:"cpu,omitempty"`
	MemTotalMB    uint64    `json:"memTotalMB,omitempty"`
	MemFreeMB     uint64    `json:"memFreeMB,omitempty"`
	CPUPercent    float64   `json:"cpuPercent,omitempty"`
	RamUsedMB     float64   `json:"ramUsedMB,omitempty"`
	RamTotalMB    float64   `json:"ramTotalMB,omitempty"`
	DiskUsedGB    float64   `json:"diskUsedGB,omitempty"`
	LatencyMS     float64   `json:"latencyMS,omitempty"`
	GameReachable bool      `json:"gameReachable"`
	DiskPath      string    `json:"diskPath,omitempty"`
	DiskFreeMB    uint64    `json:"diskFreeMB,omitempty"`
	AgentVersion  string    `json:"agentVersion,omitempty"`
	ReportedAt    time.Time `json:"reportedAt"`
}

// PairResponse is returned on successful pairing.
type PairResponse struct {
	HostID   string `json:"hostId"`
	AgentKey string `json:"agentKey"` // signed JWT or opaque token; store and use for subsequent requests
}

// Job is a work unit from the control plane.
type Job struct {
	ID               string                 `json:"jobRunId"`
	Type             string                 `json:"type"`
	ServerInstanceID string                 `json:"serverInstanceId,omitempty"`
	Payload          map[string]interface{} `json:"payload,omitempty"`
	// ScheduleID is set when this job was dispatched by the scheduler.
	ScheduleID string `json:"schedule_id,omitempty"`
}

// DiscoveredServer is agent-side local server metadata pushed to the control plane.
type DiscoveredServer struct {
	Name           string                 `json:"name,omitempty"`
	InstallPath    string                 `json:"installPath,omitempty"`
	StartCommand   string                 `json:"startCommand,omitempty"`
	TelnetHost     string                 `json:"telnetHost,omitempty"`
	TelnetPort     int                    `json:"telnetPort,omitempty"`
	TelnetPassword string                 `json:"telnetPassword,omitempty"`
	Config         map[string]interface{} `json:"config,omitempty"`
}

// JobResultPayload is sent when submitting a job result.
type JobResultPayload struct {
	Status       string                 `json:"status"`
	Output       string                 `json:"output,omitempty"`
	Result       map[string]interface{} `json:"result,omitempty"`
	Error        string                 `json:"error,omitempty"`
	DurationMs   int64                  `json:"durationMs,omitempty"`
	ErrorMessage string                 `json:"errorMessage,omitempty"`
}
