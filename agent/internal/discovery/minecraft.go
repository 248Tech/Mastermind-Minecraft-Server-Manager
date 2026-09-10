package discovery

import (
	"bufio"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/mastermind/agent/internal/config"
)

// MinecraftResult is autodiscovery output for a Java/NeoForge/Fabric/Paper server.
type MinecraftResult struct {
	Name           string                 `json:"name,omitempty"`
	InstallPath    string                 `json:"install_path,omitempty"`
	StartCommand   string                 `json:"start_command,omitempty"`
	TelnetHost     string                 `json:"telnet_host,omitempty"` // RCON host
	TelnetPort     int                    `json:"telnet_port,omitempty"` // RCON port
	TelnetPassword string                 `json:"telnet_password,omitempty"`
	Config         map[string]interface{} `json:"config,omitempty"`
}

// DiscoverMinecraft finds a Minecraft server root via server.properties and optional start scripts.
func DiscoverMinecraft(cfg config.MinecraftDiscoveryCfg) (*MinecraftResult, error) {
	propsPath := firstNonEmpty(
		cfg.ServerPropertiesPath,
		filepath.Join(cfg.InstallPath, "server.properties"),
	)
	propsPath = firstExistingFile(
		propsPath,
		filepath.Join(cfg.InstallPath, "server.properties"),
	)
	if propsPath == "" {
		return nil, errors.New("minecraft server.properties not found")
	}

	installPath := cfg.InstallPath
	if installPath == "" {
		installPath = filepath.Dir(propsPath)
	}

	props, err := loadJavaProperties(propsPath)
	if err != nil {
		return nil, err
	}

	rconPort, _ := strconv.Atoi(firstNonEmpty(props["rcon.port"], "25575"))
	gamePort, _ := strconv.Atoi(firstNonEmpty(props["server-port"], "25565"))
	levelName := firstNonEmpty(props["level-name"], "world")
	motd := strings.TrimSpace(props["motd"])
	name := firstNonEmpty(cfg.Name, stripMOTDColor(motd), filepath.Base(installPath))

	modsPath := firstNonEmpty(cfg.ModsPath, filepath.Join(installPath, "mods"))
	pluginsPath := firstNonEmpty(cfg.PluginsPath, filepath.Join(installPath, "plugins"))
	worldPath := firstNonEmpty(cfg.WorldPath, filepath.Join(installPath, levelName))

	modCount, _ := countEntries(modsPath)
	pluginCount, _ := countEntries(pluginsPath)

	startCommand := cfg.StartCommand
	if startCommand == "" {
		startCommand = detectMinecraftStartCommand(installPath)
	}

	result := &MinecraftResult{
		Name:           name,
		InstallPath:    installPath,
		StartCommand:   startCommand,
		TelnetHost:     "127.0.0.1",
		TelnetPort:     rconPort,
		TelnetPassword: props["rcon.password"],
		Config: map[string]interface{}{
			"game":              "minecraft",
			"server_properties": propsPath,
			"server_port":       gamePort,
			"rcon_enabled":      strings.EqualFold(props["enable-rcon"], "true"),
			"level_name":        levelName,
			"world_path":        worldPath,
			"mods_path":         modsPath,
			"plugins_path":      pluginsPath,
			"mod_count":         modCount,
			"plugin_count":      pluginCount,
			"max_players":       props["max-players"],
			"motd":              motd,
			"online_mode":       props["online-mode"],
		},
	}
	return result, nil
}

func loadJavaProperties(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	out := make(map[string]string)
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		out[key] = val
	}
	return out, sc.Err()
}

func stripMOTDColor(s string) string {
	// Remove simple §X / &X color codes from MOTD for display names.
	runes := []rune(s)
	var b strings.Builder
	for i := 0; i < len(runes); i++ {
		if (runes[i] == '§' || runes[i] == '&') && i+1 < len(runes) {
			i++
			continue
		}
		b.WriteRune(runes[i])
	}
	return strings.TrimSpace(b.String())
}

func detectMinecraftStartCommand(installPath string) string {
	candidates := []string{
		"startserver.sh", "startserver.bat", "run.sh", "run.bat",
		"START-ATM10.bat", "start.bat", "start.sh",
	}
	for _, name := range candidates {
		p := filepath.Join(installPath, name)
		if _, err := os.Stat(p); err == nil {
			ext := strings.ToLower(filepath.Ext(name))
			if ext == ".bat" || ext == ".cmd" {
				return p
			}
			return "/bin/sh " + p
		}
	}
	for _, jar := range []string{"server.jar", "paper.jar", "purpur.jar", "fabric-server-launch.jar"} {
		if _, err := os.Stat(filepath.Join(installPath, jar)); err == nil {
			return "java -jar " + jar
		}
	}
	return ""
}

func countEntries(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		n++
	}
	return n, nil
}
