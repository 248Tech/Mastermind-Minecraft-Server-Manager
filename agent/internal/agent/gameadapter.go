package agent

import (
	"context"
	"errors"
	"io"
)

// ErrUnsupported is returned when a capability is not implemented by the adapter.
var ErrUnsupported = errors.New("capability not supported by this game adapter")

// Capability names used by the control-plane registry and UI to show only supported actions.
const (
	CapStart       = "start"
	CapStop        = "stop"
	CapRestart     = "restart"
	CapStatus      = "status"
	CapSendCommand = "send_command"
	CapStreamChat  = "stream_chat"
	CapKickPlayer  = "kick_player"
	CapBanPlayer   = "ban_player"
	CapInstallMod  = "install_mod" // optional
	CapGetLogPath  = "get_log_path"
)

// AllCapabilities is the full set for adapters that support everything.
var AllCapabilities = []string{
	CapStart, CapStop, CapRestart, CapStatus, CapSendCommand,
	CapStreamChat, CapKickPlayer, CapBanPlayer, CapInstallMod, CapGetLogPath,
}

// InstanceConfig holds server instance configuration passed to adapter methods.
// Populated from job payload (control plane) or agent local config.
type InstanceConfig struct {
	ServerInstanceID string
	InstallPath      string
	StartCommand     string
	StopCommand      string
	// Telnet/RCON for in-game commands
	TelnetHost     string
	TelnetPort     int
	TelnetPassword string
	// Optional game-specific config (e.g. log subpath, RCON port)
	Extra map[string]interface{}
}

// GameAdapter is the agent-side game adapter interface.
// Implementations are registered by game type slug (e.g. "7dtd", "minecraft").
// The control plane stores which capabilities each game type supports; the UI renders only those actions.
type GameAdapter interface {
	JobExecutor

	// Name returns the game type slug (e.g. "7dtd", "minecraft").
	Name() string

	// Capabilities returns the list of supported capability names (e.g. start, stop, send_command).
	// Must match the control-plane capability registry for this game type.
	Capabilities() []string

	// Start starts the game server.
	Start(ctx context.Context, cfg *InstanceConfig) error

	// Stop stops the game server.
	Stop(ctx context.Context, cfg *InstanceConfig) error

	// Restart restarts the game server (stop then start).
	Restart(ctx context.Context, cfg *InstanceConfig) error

	// Status returns the server status (e.g. "running", "stopped", "unknown").
	Status(ctx context.Context, cfg *InstanceConfig) (string, error)

	// SendCommand sends a raw command (e.g. RCON/telnet) and returns the response.
	SendCommand(ctx context.Context, cfg *InstanceConfig, command string) (string, error)

	// StreamChat streams chat (and optionally log) lines to w until ctx is done.
	StreamChat(ctx context.Context, cfg *InstanceConfig, w io.Writer) error

	// KickPlayer kicks a player by ID or name.
	KickPlayer(ctx context.Context, cfg *InstanceConfig, playerID string) error

	// BanPlayer bans a player by ID or name with an optional reason.
	BanPlayer(ctx context.Context, cfg *InstanceConfig, playerID string, reason string) error

	// InstallMod installs or updates a mod. Returns ErrUnsupported if not supported.
	InstallMod(ctx context.Context, cfg *InstanceConfig, modID string, opts map[string]interface{}) error

	// GetLogPath returns the path to the main log file (or directory) for this instance.
	GetLogPath(cfg *InstanceConfig) (string, error)
}

// NoopGameAdapter implements GameAdapter with no-op or ErrUnsupported for all capabilities.
// Used for unknown game types or tests.
type NoopGameAdapter struct {
	GameName string
}

func (n *NoopGameAdapter) Name() string {
	if n.GameName != "" {
		return n.GameName
	}
	return "noop"
}

func (n *NoopGameAdapter) Capabilities() []string { return nil }

func (n *NoopGameAdapter) Execute(ctx context.Context, job Job) (JobResult, error) {
	return JobResult{Status: "success", Result: map[string]interface{}{"adapter": n.Name()}}, nil
}

func (n *NoopGameAdapter) Start(ctx context.Context, cfg *InstanceConfig) error              { return ErrUnsupported }
func (n *NoopGameAdapter) Stop(ctx context.Context, cfg *InstanceConfig) error               { return ErrUnsupported }
func (n *NoopGameAdapter) Restart(ctx context.Context, cfg *InstanceConfig) error             { return ErrUnsupported }
func (n *NoopGameAdapter) Status(ctx context.Context, cfg *InstanceConfig) (string, error)    { return "unknown", nil }
func (n *NoopGameAdapter) SendCommand(ctx context.Context, cfg *InstanceConfig, cmd string) (string, error) {
	return "", ErrUnsupported
}
func (n *NoopGameAdapter) StreamChat(ctx context.Context, cfg *InstanceConfig, w io.Writer) error {
	return ErrUnsupported
}
func (n *NoopGameAdapter) KickPlayer(ctx context.Context, cfg *InstanceConfig, playerID string) error {
	return ErrUnsupported
}
func (n *NoopGameAdapter) BanPlayer(ctx context.Context, cfg *InstanceConfig, playerID string, reason string) error {
	return ErrUnsupported
}
func (n *NoopGameAdapter) InstallMod(ctx context.Context, cfg *InstanceConfig, modID string, opts map[string]interface{}) error {
	return ErrUnsupported
}
func (n *NoopGameAdapter) GetLogPath(cfg *InstanceConfig) (string, error) { return "", ErrUnsupported }
