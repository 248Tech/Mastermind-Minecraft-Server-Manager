package minecraft

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

const gameSlug = "minecraft"

var (
	listPlayersRe = regexp.MustCompile(`(?i)there are (\d+) of (?:a max of )?(\d+) players online(?::\s*(.*))?`)
	listAltRe     = regexp.MustCompile(`(?i)players online:\s*(.*)`)
)

// Adapter implements agent.GameAdapter for Minecraft (RCON + process control).
type Adapter struct {
	rconTimeout time.Duration
	stopTimeout time.Duration
}

// NewAdapter returns a Minecraft game adapter.
func NewAdapter() *Adapter {
	return &Adapter{
		rconTimeout: 15 * time.Second,
		stopTimeout: 60 * time.Second,
	}
}

func (a *Adapter) Name() string { return gameSlug }

// Capabilities returns the subset this adapter supports; control plane registry must match.
func (a *Adapter) Capabilities() []string {
	return []string{
		agent.CapStart,
		agent.CapStop,
		agent.CapRestart,
		agent.CapStatus,
		agent.CapSendCommand,
		agent.CapStreamChat,
		agent.CapKickPlayer,
		agent.CapBanPlayer,
		agent.CapGetLogPath,
		agent.CapInstallMod,
	}
}

// Execute dispatches job types to the appropriate capability.
func (a *Adapter) Execute(ctx context.Context, job agent.Job) (agent.JobResult, error) {
	cfg := payloadToConfig(job.Payload)
	switch job.Type {
	case "SERVER_START", "start":
		return resultOrErr(a.Start(ctx, cfg))
	case "SERVER_STOP", "stop":
		return resultOrErr(a.Stop(ctx, cfg))
	case "SERVER_KILL":
		return resultOrErr(a.Kill(ctx, cfg))
	case "SERVER_RESTART", "restart":
		return resultOrErr(a.Restart(ctx, cfg))
	case "SERVER_SAFE_RESTART":
		return a.SafeRestart(ctx, cfg, job.Payload)
	case "SERVER_SAVEWORLD":
		out, err := a.SendCommand(ctx, cfg, "save-all")
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "SERVER_SAVE_STOP":
		if _, err := a.SendCommand(ctx, cfg, "save-all"); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return resultOrErr(a.Stop(ctx, cfg))
	case "SERVER_WIPE_SAVE":
		if !getBool(job.Payload, "confirmed") {
			return agent.JobResult{Status: "failed", Error: "world wipe requires explicit confirmation"}, nil
		}
		path, err := a.WipeWorld(ctx, cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"deletedWorld": path}}, nil
	case "STATUS":
		st, err := a.Status(ctx, cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"status": st}}, nil
	case "RCON", "SEND_COMMAND", "rcon":
		cmd := strings.TrimSpace(getString(job.Payload, "command", ""))
		if cmd == "" {
			return agent.JobResult{Status: "failed", Error: "console command is required"}, nil
		}
		if len(cmd) > 512 || strings.ContainsAny(cmd, "\r\n") {
			return agent.JobResult{Status: "failed", Error: "console command must be one line and at most 512 characters"}, nil
		}
		out, err := a.SendCommand(ctx, cfg, cmd)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "LIST_PLAYERS", "PLAYER_LIST_SYNC":
		players, raw, err := a.ListPlayersParsed(ctx, cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"players": players, "raw": raw}}, nil
	case "PLAYER_KICK":
		name := getString(job.Payload, "player", getString(job.Payload, "player_id", getString(job.Payload, "name", getString(job.Payload, "identifier", ""))))
		reason := getString(job.Payload, "reason", "")
		if name == "" {
			return agent.JobResult{Status: "failed", Error: "player name required"}, nil
		}
		cmd := "kick " + sanitizeRCONArg(name)
		if reason != "" {
			cmd += " " + sanitizeRCONArg(reason)
		}
		out, err := a.SendCommand(ctx, cfg, cmd)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_KICK_ALL":
		out, err := a.SendCommand(ctx, cfg, "kick @a")
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_BAN":
		name := getString(job.Payload, "player", getString(job.Payload, "player_id", getString(job.Payload, "name", getString(job.Payload, "identifier", ""))))
		reason := getString(job.Payload, "reason", "")
		if name == "" {
			return agent.JobResult{Status: "failed", Error: "player name required"}, nil
		}
		return resultOrErr(a.BanPlayer(ctx, cfg, name, reason))
	case "PLAYER_ADMIN_PROMOTE":
		name := getString(job.Payload, "player", getString(job.Payload, "name", getString(job.Payload, "identifier", "")))
		if name == "" {
			return agent.JobResult{Status: "failed", Error: "player name required"}, nil
		}
		out, err := a.SendCommand(ctx, cfg, "op "+sanitizeRCONArg(name))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_ADMIN_DEMOTE":
		name := getString(job.Payload, "player", getString(job.Payload, "name", getString(job.Payload, "identifier", "")))
		if name == "" {
			return agent.JobResult{Status: "failed", Error: "player name required"}, nil
		}
		out, err := a.SendCommand(ctx, cfg, "deop "+sanitizeRCONArg(name))
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "PLAYER_ADMIN_LIST":
		admins, err := a.ListAdmins(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"admins": admins}}, nil
	case "TRIGGER_GRANT_ITEMS":
		result, err := a.GrantItems(ctx, cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "SERVER_CONFIG_READ":
		content, path, err := a.readServerProperties(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"path": path, "content": content}}, nil
	case "SERVER_CONFIG_WRITE":
		content := getString(job.Payload, "content", "")
		path, err := a.writeServerProperties(cfg, job.Payload, content)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"path": path, "saved": true}}, nil
	case "SAVE_LIST":
		saves, err := a.ListSaves(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"saves": saves}}, nil
	case "SAVE_BACKUP":
		path, err := a.BackupWorld(ctx, cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		id := filepath.Base(path)
		info, _ := os.Stat(path)
		createdAt := time.Now().UTC().Format(time.RFC3339)
		var size int64
		if info != nil {
			createdAt = info.ModTime().UTC().Format(time.RFC3339)
			size = directorySize(path)
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{
			"backup": path,
			"save": map[string]interface{}{
				"id":        id,
				"createdAt": createdAt,
				"kind":      "full-world",
				"sizeBytes": size,
			},
		}}, nil
	case "SAVE_RESTORE":
		if !getBool(job.Payload, "confirmed") {
			return agent.JobResult{Status: "failed", Error: "save restore requires explicit confirmation"}, nil
		}
		result, err := a.RestoreSave(ctx, cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "SAVE_DELETE":
		if !getBool(job.Payload, "confirmed") {
			return agent.JobResult{Status: "failed", Error: "save deletion requires explicit confirmation"}, nil
		}
		id := getString(job.Payload, "save_id", getString(job.Payload, "backup", getString(job.Payload, "id", "")))
		if err := a.DeleteSaveBackup(cfg, job.Payload); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"deleted": id}}, nil
	case "SAVE_RETENTION":
		retention := getInt(job.Payload, "retention_count", 10)
		if err := a.PruneSaveBackups(cfg, job.Payload, retention); err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"retentionCount": retention}}, nil
	case "SERVER_MAINTENANCE":
		return a.SetMaintenance(ctx, cfg, job.Payload)
	case "SERVER_UPDATE":
		return a.Update(ctx, cfg, job.Payload)
	case "MOD_LIST":
		mods, err := a.ListMods(cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"mods": mods}}, nil
	case "MOD_QUARANTINE":
		result, err := a.QuarantineMod(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "MOD_QUARANTINE_LIST":
		mods, err := a.ListQuarantinedMods(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"mods": mods}}, nil
	case "MOD_RESTORE":
		result, err := a.RestoreMod(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "MOD_DELETE":
		result, err := a.DeleteMod(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "MOD_UPLOAD_QUARANTINE":
		result, err := a.UploadMod(cfg, job.Payload, false)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "MOD_UPLOAD_PENDING":
		result, err := a.UploadMod(cfg, job.Payload, true)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "MOD_PENDING_LIST":
		mods, err := a.ListPendingMods(cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"mods": mods}}, nil
	case "MOD_PENDING_APPROVE":
		result, err := a.ApprovePendingMod(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "MOD_PENDING_REJECT":
		result, err := a.RejectPendingMod(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	case "MOD_CONFIG_READ":
		content, path, err := a.ReadModConfig(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"path": path, "content": content}}, nil
	case "MOD_CONFIG_WRITE":
		path, err := a.WriteModConfig(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"path": path, "saved": true}}, nil
	case "MOD_CONFIG_MERGE_PREVIEW":
		files, err := a.PreviewConfigMerge(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"files": files}}, nil
	case "MOD_CONFIG_MERGE_APPLY":
		result, err := a.ApplyConfigMerge(cfg, job.Payload)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: result}, nil
	default:
		return agent.JobResult{Status: "failed", Error: "unsupported job type: " + job.Type}, nil
	}
}

func resultOrErr(err error) (agent.JobResult, error) {
	if err != nil {
		return agent.JobResult{Status: "failed", Error: err.Error()}, nil
	}
	return agent.JobResult{Status: "success"}, nil
}

func payloadToConfig(p map[string]interface{}) *agent.InstanceConfig {
	if p == nil {
		return &agent.InstanceConfig{}
	}
	cfg := &agent.InstanceConfig{}
	if v, ok := p["server_instance_id"].(string); ok {
		cfg.ServerInstanceID = v
	}
	if v, ok := p["install_path"].(string); ok {
		cfg.InstallPath = v
	}
	if v, ok := p["start_command"].(string); ok {
		cfg.StartCommand = v
	}
	if v, ok := p["stop_command"].(string); ok {
		cfg.StopCommand = v
	}
	if v, ok := p["telnet_host"].(string); ok {
		cfg.TelnetHost = v
	}
	if cfg.TelnetHost == "" {
		cfg.TelnetHost = "127.0.0.1"
	}
	if v, ok := p["telnet_port"].(float64); ok {
		cfg.TelnetPort = int(v)
	} else if v, ok := p["telnet_port"].(int); ok {
		cfg.TelnetPort = v
	}
	if v, ok := p["telnet_password"].(string); ok {
		cfg.TelnetPassword = v
	}
	if v, ok := p["update_command"].(string); ok && v != "" {
		if cfg.Extra == nil {
			cfg.Extra = map[string]interface{}{}
		}
		cfg.Extra["update_command"] = v
	}
	if conf, ok := p["config"].(map[string]interface{}); ok {
		if cfg.Extra == nil {
			cfg.Extra = map[string]interface{}{}
		}
		for k, v := range conf {
			cfg.Extra[k] = v
		}
	}
	if extra, ok := p["extra"].(map[string]interface{}); ok {
		if cfg.Extra == nil {
			cfg.Extra = map[string]interface{}{}
		}
		for k, v := range extra {
			cfg.Extra[k] = v
		}
	}
	return cfg
}

func getString(m map[string]interface{}, key, def string) string {
	if m == nil {
		return def
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

func getBool(m map[string]interface{}, key string) bool {
	if m == nil {
		return false
	}
	switch v := m[key].(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true") || v == "1"
	case float64:
		return v != 0
	default:
		return false
	}
}

func getInt(m map[string]interface{}, key string, def int) int {
	if m == nil {
		return def
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case string:
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
	}
	return def
}

func (a *Adapter) withRCON(ctx context.Context, cfg *agent.InstanceConfig, fn func(*Client) error) error {
	_ = ctx
	if cfg.TelnetPassword == "" {
		return fmt.Errorf("rcon password required (telnet_password / rcon.password)")
	}
	port := cfg.TelnetPort
	if port <= 0 {
		port = 25575
	}
	client, err := Connect(cfg.TelnetHost, port, cfg.TelnetPassword, a.rconTimeout)
	if err != nil {
		return err
	}
	defer client.Close()
	return fn(client)
}

// startAndCheck runs cmd.Start(), then waits briefly; if the process exits within that window, returns an error.
func (a *Adapter) startAndCheck(ctx context.Context, cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	startupWindow := 3 * time.Second
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("process exited immediately: %w", err)
		}
		return fmt.Errorf("process exited immediately with code 0")
	case <-time.After(startupWindow):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *Adapter) Start(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.InstallPath == "" {
		return fmt.Errorf("install_path required")
	}
	if cfg.StartCommand != "" {
		return a.runStartCommand(ctx, cfg.InstallPath, cfg.StartCommand)
	}
	for _, jar := range []string{"server.jar", "paper.jar", "purpur.jar", "fabric-server-launch.jar"} {
		if _, err := os.Stat(filepath.Join(cfg.InstallPath, jar)); err == nil {
			cmd := exec.CommandContext(ctx, "java", "-jar", jar)
			cmd.Dir = cfg.InstallPath
			return a.startAndCheck(ctx, cmd)
		}
	}
	return fmt.Errorf("no start_command and no known server jar in %q", cfg.InstallPath)
}

func (a *Adapter) runStartCommand(ctx context.Context, dir, startCommand string) error {
	parts := strings.Fields(startCommand)
	if len(parts) == 0 {
		return fmt.Errorf("empty start_command")
	}
	ext := strings.ToLower(filepath.Ext(parts[0]))
	var cmd *exec.Cmd
	if ext == ".bat" || ext == ".cmd" {
		args := append([]string{"/C", parts[0]}, parts[1:]...)
		cmd = exec.CommandContext(ctx, "cmd.exe", args...)
	} else {
		cmd = exec.CommandContext(ctx, parts[0], parts[1:]...)
	}
	cmd.Dir = dir
	return a.startAndCheck(ctx, cmd)
}

func (a *Adapter) Stop(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.StopCommand != "" {
		parts := strings.Fields(cfg.StopCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty stop_command")
		}
		cmd := exec.CommandContext(ctx, parts[0], parts[1:]...)
		cmd.Dir = cfg.InstallPath
		return cmd.Run()
	}
	rconErr := a.withRCON(ctx, cfg, func(c *Client) error {
		_, err := c.Exec("stop")
		return err
	})
	host := cfg.TelnetHost
	if host == "" {
		host = "127.0.0.1"
	}
	ports := gamePorts(cfg)
	if rconErr == nil && waitPortsClosed(host, ports, 45*time.Second) {
		return nil
	}
	// Graceful RCON failed or process still listening — force-stop by port PID.
	if err := forceStopProcesses(cfg); err != nil {
		if rconErr != nil {
			return fmt.Errorf("rcon stop failed (%v); process stop failed (%w)", rconErr, err)
		}
		return err
	}
	return nil
}

func (a *Adapter) Kill(ctx context.Context, cfg *agent.InstanceConfig) error {
	_ = ctx
	if cfg.InstallPath == "" {
		return fmt.Errorf("install_path required")
	}
	// Best-effort graceful stop, then always force-kill listeners on game/RCON ports.
	_ = a.withRCON(context.Background(), cfg, func(c *Client) error {
		_, err := c.Exec("stop")
		return err
	})
	host := cfg.TelnetHost
	if host == "" {
		host = "127.0.0.1"
	}
	_ = waitPortsClosed(host, gamePorts(cfg), 5*time.Second)
	return forceStopProcesses(cfg)
}

func (a *Adapter) Restart(ctx context.Context, cfg *agent.InstanceConfig) error {
	if err := a.Stop(ctx, cfg); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(5 * time.Second):
	}
	return a.Start(ctx, cfg)
}

func (a *Adapter) SafeRestart(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (agent.JobResult, error) {
	countdown := getInt(payload, "countdown_sec", 60)
	if countdown < 5 {
		countdown = 5
	}
	if countdown > 600 {
		countdown = 600
	}
	msg := getString(payload, "message", "Server restarting for maintenance.")
	announce := fmt.Sprintf("say %s Restart in %d seconds.", sanitizeRCONArg(msg), countdown)
	if _, err := a.SendCommand(ctx, cfg, announce); err != nil {
		return agent.JobResult{Status: "failed", Error: "announce failed: " + err.Error()}, nil
	}
	deadline := time.Now().Add(time.Duration(countdown) * time.Second)
	for {
		remain := int(time.Until(deadline).Seconds())
		if remain <= 0 {
			break
		}
		if remain == 30 || remain == 10 || remain == 5 {
			_, _ = a.SendCommand(ctx, cfg, fmt.Sprintf("say Restart in %d seconds.", remain))
		}
		select {
		case <-ctx.Done():
			return agent.JobResult{Status: "failed", Error: ctx.Err().Error()}, nil
		case <-time.After(1 * time.Second):
		}
	}
	if _, err := a.SendCommand(ctx, cfg, "say Restarting now…"); err != nil {
		return agent.JobResult{Status: "failed", Error: err.Error()}, nil
	}
	if _, err := a.SendCommand(ctx, cfg, "save-all flush"); err != nil {
		_, _ = a.SendCommand(ctx, cfg, "save-all")
	}
	_, _ = a.SendCommand(ctx, cfg, "kick @a Server restarting")
	if err := a.Stop(ctx, cfg); err != nil {
		return agent.JobResult{Status: "failed", Error: "stop failed: " + err.Error()}, nil
	}
	select {
	case <-ctx.Done():
		return agent.JobResult{Status: "failed", Error: ctx.Err().Error()}, nil
	case <-time.After(5 * time.Second):
	}
	if err := a.Start(ctx, cfg); err != nil {
		return agent.JobResult{Status: "failed", Error: "start failed: " + err.Error()}, nil
	}
	return agent.JobResult{Status: "success", Result: map[string]interface{}{"restarted": true, "countdown_sec": countdown}}, nil
}

func (a *Adapter) Status(ctx context.Context, cfg *agent.InstanceConfig) (string, error) {
	err := a.withRCON(ctx, cfg, func(c *Client) error {
		_, err := c.Exec("list")
		return err
	})
	if err != nil {
		return "stopped", nil
	}
	return "running", nil
}

func (a *Adapter) SendCommand(ctx context.Context, cfg *agent.InstanceConfig, command string) (string, error) {
	var out string
	err := a.withRCON(ctx, cfg, func(c *Client) error {
		var err error
		out, err = c.Exec(command)
		return err
	})
	return out, err
}

func (a *Adapter) ListPlayersParsed(ctx context.Context, cfg *agent.InstanceConfig) ([]map[string]interface{}, string, error) {
	raw, err := a.SendCommand(ctx, cfg, "list")
	if err != nil {
		return nil, "", err
	}
	players := parseListOutput(raw)
	return players, raw, nil
}

func parseListOutput(raw string) []map[string]interface{} {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var names []string
	if m := listPlayersRe.FindStringSubmatch(raw); len(m) >= 4 {
		if strings.TrimSpace(m[3]) != "" {
			names = splitPlayerNames(m[3])
		}
	} else if m := listAltRe.FindStringSubmatch(raw); len(m) >= 2 {
		names = splitPlayerNames(m[1])
	}
	out := make([]map[string]interface{}, 0, len(names))
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		out = append(out, map[string]interface{}{"name": n})
	}
	return out
}

func splitPlayerNames(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// sanitizeRCONArg removes metacharacters that could inject additional RCON commands.
func sanitizeRCONArg(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r != ';' && r != '\n' && r != '\r' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (a *Adapter) KickPlayer(ctx context.Context, cfg *agent.InstanceConfig, playerID string) error {
	_, err := a.SendCommand(ctx, cfg, "kick "+sanitizeRCONArg(playerID))
	return err
}

func (a *Adapter) BanPlayer(ctx context.Context, cfg *agent.InstanceConfig, playerID string, reason string) error {
	cmd := "ban " + sanitizeRCONArg(playerID)
	if reason != "" {
		cmd += " " + sanitizeRCONArg(reason)
	}
	_, err := a.SendCommand(ctx, cfg, cmd)
	return err
}

func (a *Adapter) InstallMod(ctx context.Context, cfg *agent.InstanceConfig, modID string, opts map[string]interface{}) error {
	return agent.ErrUnsupported
}

func (a *Adapter) GetLogPath(cfg *agent.InstanceConfig) (string, error) {
	if cfg.InstallPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	return filepath.Join(cfg.InstallPath, "logs", "latest.log"), nil
}

func (a *Adapter) propertiesPath(cfg *agent.InstanceConfig, payload map[string]interface{}) string {
	if p := getString(payload, "server_config_path", ""); p != "" {
		return p
	}
	if p := getString(payload, "path", ""); p != "" {
		return p
	}
	return filepath.Join(cfg.InstallPath, "server.properties")
}

func (a *Adapter) readServerProperties(cfg *agent.InstanceConfig, payload map[string]interface{}) (string, string, error) {
	if cfg.InstallPath == "" && getString(payload, "server_config_path", "") == "" {
		return "", "", fmt.Errorf("install_path required")
	}
	path := a.propertiesPath(cfg, payload)
	b, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	return string(b), path, nil
}

func (a *Adapter) writeServerProperties(cfg *agent.InstanceConfig, payload map[string]interface{}, content string) (string, error) {
	if content == "" {
		return "", fmt.Errorf("content required")
	}
	if cfg.InstallPath == "" && getString(payload, "server_config_path", "") == "" {
		return "", fmt.Errorf("install_path required")
	}
	path := a.propertiesPath(cfg, payload)
	tmp := path + ".mastermind.tmp"
	if err := os.WriteFile(tmp, []byte(content), 0644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return path, nil
}

func (a *Adapter) worldPath(cfg *agent.InstanceConfig, payload map[string]interface{}) (string, error) {
	if p := getString(payload, "world_path", ""); p != "" {
		return p, nil
	}
	level := getString(payload, "level_name", "")
	if level == "" {
		propsPath := a.propertiesPath(cfg, payload)
		if b, err := os.ReadFile(propsPath); err == nil {
			for _, line := range strings.Split(string(b), "\n") {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "level-name=") {
					level = strings.TrimSpace(strings.TrimPrefix(line, "level-name="))
					break
				}
			}
		}
	}
	if level == "" {
		level = "world"
	}
	if cfg.InstallPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	return filepath.Join(cfg.InstallPath, level), nil
}

func (a *Adapter) WipeWorld(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (string, error) {
	_ = a.Stop(ctx, cfg)
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-time.After(3 * time.Second):
	}
	world, err := a.worldPath(cfg, payload)
	if err != nil {
		return "", err
	}
	if err := os.RemoveAll(world); err != nil {
		return "", err
	}
	// Also remove common companion dims next to the overworld folder name.
	base := filepath.Base(world)
	parent := filepath.Dir(world)
	for _, suffix := range []string{"_nether", "_the_end"} {
		_ = os.RemoveAll(filepath.Join(parent, base+suffix))
	}
	return world, nil
}

func (a *Adapter) BackupWorld(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (string, error) {
	_, _ = a.SendCommand(ctx, cfg, "save-all flush")
	world, err := a.worldPath(cfg, payload)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(world); err != nil {
		return "", err
	}
	backupRoot := getString(payload, "backup_dir", filepath.Join(cfg.InstallPath, "mastermind-backups"))
	if err := os.MkdirAll(backupRoot, 0755); err != nil {
		return "", err
	}
	stamp := time.Now().UTC().Format("20060102-150405")
	dest := filepath.Join(backupRoot, filepath.Base(world)+"-"+stamp)
	if err := copyDir(world, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func (a *Adapter) ListMods(cfg *agent.InstanceConfig) ([]map[string]interface{}, error) {
	if cfg.InstallPath == "" {
		return nil, fmt.Errorf("install_path required")
	}
	var out []map[string]interface{}
	for _, folder := range []string{"mods", "plugins"} {
		dir := filepath.Join(cfg.InstallPath, folder)
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := e.Name()
			if strings.HasPrefix(name, ".") {
				continue
			}
			info, _ := e.Info()
			item := map[string]interface{}{
				"name":   name,
				"folder": name,
				"kind":   folder,
				"path":   folder + "/" + name,
				"dir":    e.IsDir(),
			}
			if info != nil {
				item["size"] = info.Size()
				item["modTime"] = info.ModTime().UTC().Format(time.RFC3339)
				item["activatedAt"] = info.ModTime().UTC().Format(time.RFC3339)
			}
			if !e.IsDir() && strings.HasSuffix(strings.ToLower(name), ".jar") {
				enrichModRecord(cfg, item, filepath.Join(dir, name), nil, false)
			}
			out = append(out, item)
		}
	}
	return out, nil
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode())
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(out, in)
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
}
