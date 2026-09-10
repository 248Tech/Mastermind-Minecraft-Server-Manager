package discovery

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
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
			"discovery": map[string]interface{}{
				"managedByAgent": true,
			},
		},
	}
	if hint := detectMapEmbedHint(installPath, modsPath); hint != "" {
		result.Config["map_embed_hint"] = hint
	}
	return result, nil
}

// detectMapEmbedHint looks for BlueMap/Dynmap/Squaremap under the install and returns a local URL hint.
func detectMapEmbedHint(installPath, modsPath string) string {
	lowerNames := map[string]bool{}
	for _, dir := range []string{modsPath, filepath.Join(installPath, "mods"), filepath.Join(installPath, "plugins")} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			lowerNames[strings.ToLower(e.Name())] = true
		}
	}
	has := func(substr string) bool {
		for name := range lowerNames {
			if strings.Contains(name, substr) {
				return true
			}
		}
		return false
	}
	// Config dirs are a stronger signal than jar name alone.
	if _, err := os.Stat(filepath.Join(installPath, "config", "bluemap")); err == nil || has("bluemap") {
		port := readIntFromFile(filepath.Join(installPath, "config", "bluemap", "webserver.conf"), "port:", 8100)
		return fmt.Sprintf("http://127.0.0.1:%d/", port)
	}
	if _, err := os.Stat(filepath.Join(installPath, "dynmap")); err == nil || has("dynmap") {
		port := readIntFromFile(filepath.Join(installPath, "dynmap", "configuration.txt"), "webserver-port:", 8123)
		return fmt.Sprintf("http://127.0.0.1:%d/", port)
	}
	if has("squaremap") {
		return "http://127.0.0.1:8080/"
	}
	return ""
}

func readIntFromFile(path, key string, def int) int {
	b, err := os.ReadFile(path)
	if err != nil {
		return def
	}
	key = strings.ToLower(key)
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if !strings.HasPrefix(lower, key) {
			continue
		}
		rest := strings.TrimSpace(line[len(key):])
		rest = strings.Trim(rest, "\"'")
		if n, err := strconv.Atoi(rest); err == nil && n > 0 && n < 65536 {
			return n
		}
	}
	return def
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
	// Prefer OS-native launchers first so Windows hosts don't pick *.sh when a .bat exists.
	var preferred []string
	if runtime.GOOS == "windows" {
		preferred = []string{
			"startserver.bat", "run.bat", "start.bat", "start.cmd",
			"startserver.sh", "run.sh", "start.sh",
		}
	} else {
		preferred = []string{
			"startserver.sh", "run.sh", "start.sh",
			"startserver.bat", "run.bat", "start.bat", "start.cmd",
		}
	}
	for _, name := range preferred {
		p := filepath.Join(installPath, name)
		if _, err := os.Stat(p); err == nil {
			return formatStartCommand(p)
		}
	}
	entries, err := os.ReadDir(installPath)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			lower := strings.ToLower(name)
			if !strings.HasPrefix(lower, "start") {
				continue
			}
			if runtime.GOOS == "windows" {
				if strings.HasSuffix(lower, ".bat") || strings.HasSuffix(lower, ".cmd") {
					return formatStartCommand(filepath.Join(installPath, name))
				}
				continue
			}
			if strings.HasSuffix(lower, ".sh") || strings.HasSuffix(lower, ".bat") || strings.HasSuffix(lower, ".cmd") {
				return formatStartCommand(filepath.Join(installPath, name))
			}
		}
	}
	for _, jar := range []string{"server.jar", "paper.jar", "purpur.jar", "fabric-server-launch.jar"} {
		if _, err := os.Stat(filepath.Join(installPath, jar)); err == nil {
			return "java -jar " + jar
		}
	}
	return ""
}

func formatStartCommand(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".bat" || ext == ".cmd" {
		return path
	}
	return "/bin/sh " + path
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
