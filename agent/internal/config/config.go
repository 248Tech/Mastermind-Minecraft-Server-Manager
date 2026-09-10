package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"

	"gopkg.in/yaml.v3"
)

const (
	maxLongPollSeconds = 120
	maxConcurrentReads = 64
)

// Config is the agent configuration (YAML or JSON via file).
type Config struct {
	ControlPlaneURL string       `yaml:"control_plane_url" json:"control_plane_url"`
	PairingToken    string       `yaml:"pairing_token,omitempty" json:"pairing_token,omitempty"`
	AgentKeyPath    string       `yaml:"agent_key_path" json:"agent_key_path"` // where to store signed key after pairing
	Heartbeat       HeartbeatCfg `yaml:"heartbeat" json:"heartbeat"`
	Jobs            JobsCfg      `yaml:"jobs" json:"jobs"`
	Host            HostCfg      `yaml:"host" json:"host"`
	Discovery       DiscoveryCfg `yaml:"discovery" json:"discovery"`
	Logs            LogsCfg      `yaml:"logs" json:"logs"`
}

type LogsCfg struct {
	Enabled          bool   `yaml:"enabled" json:"enabled"`
	Path             string `yaml:"path" json:"path"`
	ServerInstanceID string `yaml:"server_instance_id" json:"server_instance_id"`
	PollIntervalSec  int    `yaml:"poll_interval_sec" json:"poll_interval_sec"`
}

type HeartbeatCfg struct {
	IntervalSec int `yaml:"interval_sec" json:"interval_sec"` // 5–10
}

type JobsCfg struct {
	PollIntervalSec    int  `yaml:"poll_interval_sec" json:"poll_interval_sec"`
	LongPollSec        int  `yaml:"long_poll_sec" json:"long_poll_sec"` // 0 = short poll
	MaxConcurrentReads int  `yaml:"max_concurrent_reads" json:"max_concurrent_reads"`
	WebSocket          bool `yaml:"websocket" json:"websocket"` // future
}

type HostCfg struct {
	Name string `yaml:"name" json:"name"` // optional; CP may override
}

type DiscoveryCfg struct {
	Enabled   bool                  `yaml:"enabled" json:"enabled"`
	Minecraft MinecraftDiscoveryCfg `yaml:"minecraft" json:"minecraft"`
}

// MinecraftDiscoveryCfg autodetects Java/NeoForge/Fabric/Paper installs from server.properties.
type MinecraftDiscoveryCfg struct {
	Enabled              bool   `yaml:"enabled" json:"enabled"`
	InstallPath          string `yaml:"install_path" json:"install_path"`
	ServerPropertiesPath string `yaml:"server_properties_path" json:"server_properties_path"`
	ModsPath             string `yaml:"mods_path" json:"mods_path"`
	PluginsPath          string `yaml:"plugins_path" json:"plugins_path"`
	WorldPath            string `yaml:"world_path" json:"world_path"`
	StartCommand         string `yaml:"start_command" json:"start_command"`
	Name                 string `yaml:"name" json:"name"`
}

// Load reads config from path. Supports .yaml, .yml, .json.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	c := new(Config)
	switch filepath.Ext(path) {
	case ".json":
		return c, json.Unmarshal(data, c)
	default:
		return c, yaml.Unmarshal(data, c)
	}
}

// Env overrides config fields from MASTERMIND_* environment variables.
// Call after Load() and Defaults() so env vars always win.
func (c *Config) Env() {
	if v := os.Getenv("MASTERMIND_CP_URL"); v != "" {
		c.ControlPlaneURL = v
	}
	if v := os.Getenv("MASTERMIND_PAIRING_TOKEN"); v != "" {
		c.PairingToken = v
	}
	if v := os.Getenv("MASTERMIND_HOST_NAME"); v != "" {
		c.Host.Name = v
	}
	if v := os.Getenv("MASTERMIND_KEY_PATH"); v != "" {
		c.AgentKeyPath = v
	}
	if v := os.Getenv("MASTERMIND_DISCOVERY_ENABLED"); v != "" {
		c.Discovery.Enabled = v == "1" || v == "true" || v == "TRUE"
	}
	if v := os.Getenv("MASTERMIND_MC_DISCOVERY_ENABLED"); v != "" {
		c.Discovery.Minecraft.Enabled = v == "1" || v == "true" || v == "TRUE"
	}
	if v := os.Getenv("MASTERMIND_MC_INSTALL_PATH"); v != "" {
		c.Discovery.Minecraft.InstallPath = v
	}
	if v := os.Getenv("MASTERMIND_MC_SERVER_PROPERTIES"); v != "" {
		c.Discovery.Minecraft.ServerPropertiesPath = v
	}
	if v := os.Getenv("MASTERMIND_MC_MODS_PATH"); v != "" {
		c.Discovery.Minecraft.ModsPath = v
	}
	if v := os.Getenv("MASTERMIND_MC_PLUGINS_PATH"); v != "" {
		c.Discovery.Minecraft.PluginsPath = v
	}
	if v := os.Getenv("MASTERMIND_MC_WORLD_PATH"); v != "" {
		c.Discovery.Minecraft.WorldPath = v
	}
	if v := os.Getenv("MASTERMIND_MC_START_COMMAND"); v != "" {
		c.Discovery.Minecraft.StartCommand = v
	}
	if v := os.Getenv("MASTERMIND_MC_NAME"); v != "" {
		c.Discovery.Minecraft.Name = v
	}
	if v := os.Getenv("MASTERMIND_JOBS_MAX_CONCURRENT_READS"); v != "" {
		// Invalid or non-positive environment values are ignored so they cannot
		// accidentally disable the job loop's read worker pool.
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > maxConcurrentReads {
				n = maxConcurrentReads
			}
			c.Jobs.MaxConcurrentReads = n
		}
	}
}

// Defaults applies MVP defaults (heartbeat 5s, key path).
func (c *Config) Defaults() {
	if c.Heartbeat.IntervalSec <= 0 {
		c.Heartbeat.IntervalSec = 5
	}
	if c.AgentKeyPath == "" {
		c.AgentKeyPath = "/var/lib/mastermind-agent/agent.key"
	}
	if c.Jobs.PollIntervalSec <= 0 {
		c.Jobs.PollIntervalSec = 5
	}
	if c.Jobs.LongPollSec < 0 {
		c.Jobs.LongPollSec = 0
	} else if c.Jobs.LongPollSec > maxLongPollSeconds {
		c.Jobs.LongPollSec = maxLongPollSeconds
	}
	if c.Jobs.MaxConcurrentReads <= 0 {
		c.Jobs.MaxConcurrentReads = 8
	} else if c.Jobs.MaxConcurrentReads > maxConcurrentReads {
		c.Jobs.MaxConcurrentReads = maxConcurrentReads
	}
	if c.Logs.PollIntervalSec <= 0 {
		c.Logs.PollIntervalSec = 2
	}
}
