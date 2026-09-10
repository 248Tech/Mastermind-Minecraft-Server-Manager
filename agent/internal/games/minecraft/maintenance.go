package minecraft

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

func (a *Adapter) SetMaintenance(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (agent.JobResult, error) {
	enabled := getBool(payload, "enabled")
	msg := getString(payload, "message", "")
	if enabled {
		if msg == "" {
			msg = "Server entering maintenance"
		}
		_, _ = a.SendCommand(ctx, cfg, "say "+sanitizeRCONArg(msg))
		kickReason := getString(payload, "kick_reason", msg)
		_, _ = a.SendCommand(ctx, cfg, "kick @a "+sanitizeRCONArg(kickReason))
	} else if msg != "" {
		_, _ = a.SendCommand(ctx, cfg, "say "+sanitizeRCONArg(msg))
	}

	whitelist := strings.ToLower(strings.TrimSpace(getString(payload, "whitelist", "")))
	if whitelist == "" {
		if _, ok := payload["whitelist_enabled"]; ok {
			if getBool(payload, "whitelist_enabled") {
				whitelist = "on"
			} else {
				whitelist = "off"
			}
		}
	}
	var whitelistOut string
	if whitelist == "on" || whitelist == "off" {
		out, err := a.SendCommand(ctx, cfg, "whitelist "+whitelist)
		whitelistOut = out
		if err != nil {
			return agent.JobResult{Status: "failed", Error: "whitelist command failed: " + err.Error(), Output: out, Result: map[string]interface{}{"maintenance": enabled}}, nil
		}
	}

	state := "disabled"
	if enabled {
		state = "enabled"
	}
	return agent.JobResult{
		Status: "success",
		Output: fmt.Sprintf("Maintenance %s", state),
		Result: map[string]interface{}{
			"maintenance": enabled,
			"whitelist":   whitelist,
			"whitelistOut": whitelistOut,
		},
	}, nil
}

func (a *Adapter) Update(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (agent.JobResult, error) {
	cmdLine := strings.TrimSpace(getString(payload, "update_command", ""))
	if cmdLine == "" && cfg.Extra != nil {
		if v, ok := cfg.Extra["update_command"].(string); ok {
			cmdLine = strings.TrimSpace(v)
		}
	}
	if cmdLine == "" {
		return agent.JobResult{Status: "failed", Error: "update_command required in payload or instance config"}, nil
	}
	if cfg.InstallPath == "" {
		return agent.JobResult{Status: "failed", Error: "install_path required"}, nil
	}

	wasRunning := false
	if st, err := a.Status(ctx, cfg); err == nil && st == "running" {
		wasRunning = true
	}
	if wasRunning {
		_, _ = a.SendCommand(ctx, cfg, "save-all flush")
		if err := a.Stop(ctx, cfg); err != nil {
			return agent.JobResult{Status: "failed", Error: "stop before update: " + err.Error()}, nil
		}
		select {
		case <-ctx.Done():
			return agent.JobResult{Status: "failed", Error: ctx.Err().Error()}, nil
		case <-time.After(3 * time.Second):
		}
	}

	out, err := runShellInDir(ctx, cfg.InstallPath, cmdLine)
	if err != nil {
		if wasRunning {
			_ = a.Start(ctx, cfg)
		}
		return agent.JobResult{Status: "failed", Error: err.Error(), Output: out, Result: map[string]interface{}{"status": "failed"}}, nil
	}

	started := false
	if wasRunning {
		if err := a.Start(ctx, cfg); err != nil {
			return agent.JobResult{Status: "failed", Error: "update finished but server did not start: " + err.Error(), Output: out}, nil
		}
		started = true
	}
	return agent.JobResult{
		Status: "success",
		Output: strings.TrimSpace(out),
		Result: map[string]interface{}{"status": "updated", "started": started},
	}, nil
}

func runShellInDir(ctx context.Context, dir, command string) (string, error) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd.exe", "/C", command)
	} else {
		cmd = exec.CommandContext(ctx, "/bin/sh", "-c", command)
	}
	cmd.Dir = dir
	cmd.Env = os.Environ()
	b, err := cmd.CombinedOutput()
	return string(b), err
}
