package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	defaultRequestTimeout   = 30 * time.Second
	defaultLogUploadTimeout = 30 * time.Second
	longPollGrace           = 10 * time.Second
	maxErrorBodyBytes       = 4 * 1024
)

var (
	jsonSecretPattern      = regexp.MustCompile(`(?i)("(?:agentKey|token|password|authorization)"\s*:\s*")[^"]*(")`)
	truncatedSecretPattern = regexp.MustCompile(`(?i)("(?:agentKey|token|password|authorization)"\s*:\s*")[^"]*$`)
	bearerPattern          = regexp.MustCompile(`(?i)\bbearer\s+[^\s,;]+`)
)

// HTTPClient is the default Client implementation.
type HTTPClient struct {
	BaseURL          string
	AgentKey         string // loaded from file after pairing
	HTTPClient       *http.Client
	requestTimeout   time.Duration
	logUploadTimeout time.Duration
	longPollGrace    time.Duration
}

func isSuccess(statusCode int) bool {
	return statusCode >= http.StatusOK && statusCode < http.StatusMultipleChoices
}

// NewHTTPClient creates a client. AgentKey can be empty before pairing; set after Pair succeeds.
func NewHTTPClient(baseURL string, agentKey string) *HTTPClient {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyFromEnvironment
	transport.DialContext = (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.ForceAttemptHTTP2 = true
	transport.MaxIdleConns = 100
	transport.MaxIdleConnsPerHost = 16
	transport.MaxConnsPerHost = 32
	transport.IdleConnTimeout = 90 * time.Second
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ExpectContinueTimeout = time.Second

	return &HTTPClient{
		BaseURL:  baseURL,
		AgentKey: agentKey,
		HTTPClient: &http.Client{
			// Deadlines are request-specific so legitimate long polls are not
			// terminated by the ordinary API timeout.
			Transport: transport,
		},
		requestTimeout:   defaultRequestTimeout,
		logUploadTimeout: defaultLogUploadTimeout,
		longPollGrace:    longPollGrace,
	}
}

func (c *HTTPClient) timeoutContext(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, timeout)
}

func (c *HTTPClient) ordinaryTimeout() time.Duration {
	if c.requestTimeout <= 0 {
		return defaultRequestTimeout
	}
	return c.requestTimeout
}

func (c *HTTPClient) pollTimeout(longPollSec int) time.Duration {
	if longPollSec <= 0 {
		return c.ordinaryTimeout()
	}
	grace := c.longPollGrace
	if grace <= 0 {
		grace = longPollGrace
	}
	return time.Duration(longPollSec)*time.Second + grace
}

func closeResponse(body io.ReadCloser) {
	// Consume small response bodies to allow the transport to reuse the
	// connection. The bound avoids spending unbounded time on unexpected data.
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 32*1024))
	_ = body.Close()
}

func responseError(operation string, resp *http.Response) error {
	content, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes+1))
	truncated := len(content) > maxErrorBodyBytes
	if truncated {
		content = content[:maxErrorBodyBytes]
	}
	detail := strings.TrimSpace(string(content))
	if detail == "" {
		return fmt.Errorf("%s: %s", operation, resp.Status)
	}
	// Keep errors single-line and bounded for safe operational logging.
	detail = strings.NewReplacer("\r", " ", "\n", " ").Replace(detail)
	detail = jsonSecretPattern.ReplaceAllString(detail, `${1}[REDACTED]${2}`)
	detail = truncatedSecretPattern.ReplaceAllString(detail, `${1}[REDACTED]`)
	detail = bearerPattern.ReplaceAllString(detail, "Bearer [REDACTED]")
	if truncated {
		detail += "…"
	}
	return fmt.Errorf("%s: %s: %s", operation, resp.Status, detail)
}

// Pair implements Client.
func (c *HTTPClient) Pair(ctx context.Context, pairingToken string, meta *HostMetadata) (*PairResponse, error) {
	ctx, cancel := c.timeoutContext(ctx, c.ordinaryTimeout())
	defer cancel()
	meta.ReportedAt = time.Now().UTC()
	body, err := json.Marshal(map[string]interface{}{
		"pairingToken": pairingToken,
		"hostMetadata": meta,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/pair", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return nil, responseError("pair", resp)
	}
	var out PairResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Heartbeat implements Client.
func (c *HTTPClient) Heartbeat(ctx context.Context, hostID string, meta *HostMetadata) error {
	ctx, cancel := c.timeoutContext(ctx, c.ordinaryTimeout())
	defer cancel()
	meta.ReportedAt = time.Now().UTC()
	body, _ := json.Marshal(map[string]interface{}{"metrics": map[string]interface{}{
		"cpu": meta.CPUPercent, "ramUsedMb": meta.RamUsedMB, "ramTotalMb": meta.RamTotalMB,
		"diskUsedGb": meta.DiskUsedGB, "latencyMs": meta.LatencyMS,
		"gameReachable": meta.GameReachable, "agentVersion": meta.AgentVersion,
	}})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/hosts/"+url.PathEscape(hostID)+"/heartbeat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return responseError("heartbeat", resp)
	}
	return nil
}

// SyncDiscoveredServer implements Client. Returns the control-plane server instance id when present.
func (c *HTTPClient) SyncDiscoveredServer(ctx context.Context, hostID string, gameType string, server *DiscoveredServer) (string, error) {
	ctx, cancel := c.timeoutContext(ctx, c.ordinaryTimeout())
	defer cancel()
	body, err := json.Marshal(server)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.BaseURL+"/api/agent/hosts/"+url.PathEscape(hostID)+"/server-instances/discover/"+url.PathEscape(strings.ToLower(gameType)),
		bytes.NewReader(body),
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return "", responseError("sync discovered server", resp)
	}
	var payload struct {
		ID               string `json:"id"`
		ServerInstanceID string `json:"serverInstanceId"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&payload)
	id := strings.TrimSpace(payload.ServerInstanceID)
	if id == "" {
		id = strings.TrimSpace(payload.ID)
	}
	return id, nil
}

// PollJobs implements Client. Uses GET with timeout query for long-poll.
func (c *HTTPClient) PollJobs(ctx context.Context, hostID string, longPollSec int, mutationBusy bool) ([]Job, error) {
	ctx, cancel := c.timeoutContext(ctx, c.pollTimeout(longPollSec))
	defer cancel()
	requestURL := c.BaseURL + "/api/agent/hosts/" + url.PathEscape(hostID) + "/jobs/poll"
	requestURL += fmt.Sprintf("?wait=%d&mutationBusy=%t", longPollSec, mutationBusy)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return nil, responseError("poll jobs", resp)
	}
	var payload struct {
		Job *Job `json:"job"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Job == nil {
		return nil, nil
	}
	return []Job{*payload.Job}, nil
}

func (c *HTTPClient) DownloadJobFile(ctx context.Context, hostID string, jobID string, destination io.Writer) error {
	ctx, cancel := c.timeoutContext(ctx, 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/api/agent/hosts/"+url.PathEscape(hostID)+"/jobs/"+url.PathEscape(jobID)+"/file", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("download job file: %w", err)
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return responseError("download job file", resp)
	}
	const maxArchiveBytes = 256 * 1024 * 1024
	written, err := io.Copy(destination, io.LimitReader(resp.Body, maxArchiveBytes+1))
	if err != nil {
		return fmt.Errorf("download job file: %w", err)
	}
	if written > maxArchiveBytes {
		return fmt.Errorf("mod archive exceeds 256 MiB limit")
	}
	return nil
}

// SubmitJobResult implements Client.
func (c *HTTPClient) SubmitJobResult(ctx context.Context, hostID string, jobID string, result *JobResultPayload) error {
	ctx, cancel := c.timeoutContext(ctx, c.ordinaryTimeout())
	defer cancel()
	body, _ := json.Marshal(result)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/hosts/"+url.PathEscape(hostID)+"/jobs/"+url.PathEscape(jobID)+"/result", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return responseError("submit result", resp)
	}
	return nil
}

// SubmitJobProgress implements Client.
func (c *HTTPClient) SubmitJobProgress(ctx context.Context, hostID string, jobID string, phase string, message string) error {
	ctx, cancel := c.timeoutContext(ctx, c.ordinaryTimeout())
	defer cancel()
	body, _ := json.Marshal(map[string]string{"phase": phase, "message": message})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/hosts/"+url.PathEscape(hostID)+"/jobs/"+url.PathEscape(jobID)+"/progress", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return responseError("submit progress", resp)
	}
	return nil
}

// StreamLog implements Client.
func (c *HTTPClient) StreamLog(ctx context.Context, hostID string, serverInstanceID string, r io.Reader) error {
	content, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	return c.StreamLogBytes(ctx, hostID, serverInstanceID, content)
}

// StreamLogBytes uploads an in-memory log chunk without an avoidable
// reader/read-all copy. StreamLog remains available for API compatibility.
func (c *HTTPClient) StreamLogBytes(ctx context.Context, hostID string, serverInstanceID string, content []byte) error {
	timeout := c.logUploadTimeout
	if timeout <= 0 {
		timeout = defaultLogUploadTimeout
	}
	ctx, cancel := c.timeoutContext(ctx, timeout)
	defer cancel()
	body, err := json.Marshal(map[string]string{"content": string(content)})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/hosts/"+url.PathEscape(hostID)+"/log", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	req.Header.Set("X-Server-Instance-ID", serverInstanceID)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer closeResponse(resp.Body)
	if !isSuccess(resp.StatusCode) {
		return responseError("stream log", resp)
	}
	return nil
}

// LoadAgentKey reads the stored key from path (after pairing).
func LoadAgentKey(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}
