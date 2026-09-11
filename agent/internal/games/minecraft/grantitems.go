package minecraft

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/mastermind/agent/internal/agent"
)

type grantItem struct {
	Name     string
	Quantity int
}

func grantItemsFromPayload(payload map[string]interface{}) ([]grantItem, error) {
	raw, ok := payload["items"].([]interface{})
	if !ok || len(raw) == 0 {
		return nil, fmt.Errorf("at least one grant item is required")
	}
	if len(raw) > 16 {
		return nil, fmt.Errorf("at most 16 grant items are allowed")
	}
	items := make([]grantItem, 0, len(raw))
	for _, row := range raw {
		record, ok := row.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("invalid grant item")
		}
		name := sanitizeItemID(getString(record, "name", ""))
		quantity := getInt(record, "quantity", 1)
		if name == "" || quantity < 1 || quantity > 2304 {
			return nil, fmt.Errorf("invalid grant item")
		}
		items = append(items, grantItem{Name: name, Quantity: quantity})
	}
	return items, nil
}

func sanitizeItemID(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == ':' || r == '/' || r == '.' || r == '-' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (a *Adapter) GrantItems(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	player := grantPlayerTarget(payload)
	if player == "" {
		return nil, fmt.Errorf("player name or uuid required")
	}
	items, err := grantItemsFromPayload(payload)
	if err != nil {
		return nil, err
	}
	outputs := make([]string, 0, len(items))
	delivered := make([]string, 0, len(items))
	for _, item := range items {
		cmd := fmt.Sprintf("give %s %s %d", player, item.Name, item.Quantity)
		out, sendErr := a.SendCommand(ctx, cfg, cmd)
		if strings.TrimSpace(out) != "" {
			outputs = append(outputs, out)
		}
		if sendErr != nil {
			return nil, sendErr
		}
		if grantOutputMeansOffline(out) {
			return nil, fmt.Errorf("%s", strings.TrimSpace(out))
		}
		if grantOutputMeansFailed(out) {
			return nil, fmt.Errorf("%s", strings.TrimSpace(out))
		}
		if !grantOutputMeansDelivered(out) {
			msg := strings.TrimSpace(out)
			if msg == "" {
				msg = "give produced no confirmation (player may be offline)"
			}
			return nil, fmt.Errorf("%s", msg)
		}
		delivered = append(delivered, fmt.Sprintf("%dx %s", item.Quantity, item.Name))
	}
	if msg := strings.TrimSpace(getString(payload, "message", "")); msg != "" {
		_, _ = a.SendCommand(ctx, cfg, "tell "+player+" "+sanitizeRCONArg(msg))
	}
	return map[string]interface{}{
		"delivered": delivered,
		"output":    strings.Join(outputs, "\n"),
		"player":    player,
	}, nil
}

// grantPlayerTarget prefers an in-game name, then bare UUID (Minecraft give accepts both).
func grantPlayerTarget(payload map[string]interface{}) string {
	name := sanitizeRCONArg(getString(payload, "player", getString(payload, "name", "")))
	if name != "" && !strings.EqualFold(name, "all") {
		return name
	}
	uuid := strings.TrimSpace(getString(payload, "uuid", ""))
	if uuid == "" {
		key := strings.TrimSpace(getString(payload, "identityKey", getString(payload, "identity_key", "")))
		if strings.HasPrefix(strings.ToLower(key), "uuid:") {
			uuid = key[5:]
		}
	}
	uuid = strings.ToLower(strings.TrimSpace(uuid))
	if isMinecraftUUID(uuid) {
		return uuid
	}
	return ""
}

func isMinecraftUUID(s string) bool {
	if len(s) != 32 && len(s) != 36 {
		return false
	}
	for _, r := range s {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || r == '-' {
			continue
		}
		return false
	}
	return true
}

func grantOutputMeansOffline(out string) bool {
	return regexp.MustCompile(`(?i)no player was found|player not found|must be online|that player cannot be found`).MatchString(out)
}

func grantOutputMeansFailed(out string) bool {
	return regexp.MustCompile(`(?i)there is no such item|unknown item|invalid item|expected item|incorrect argument|syntax error|unknown or incomplete command`).MatchString(out)
}

func grantOutputMeansDelivered(out string) bool {
	return regexp.MustCompile(`(?i)\bgave\b`).MatchString(out)
}

type opsEntry struct {
	UUID                 string `json:"uuid"`
	Name                 string `json:"name"`
	Level                int    `json:"level"`
	BypassesPlayerLimit  bool   `json:"bypassesPlayerLimit"`
}

func (a *Adapter) ListAdmins(cfg *agent.InstanceConfig, payload map[string]interface{}) ([]map[string]interface{}, error) {
	path := getString(payload, "ops_path", "")
	if path == "" {
		if cfg.InstallPath == "" {
			return nil, fmt.Errorf("install_path required")
		}
		path = filepath.Join(cfg.InstallPath, "ops.json")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []map[string]interface{}{}, nil
		}
		return nil, err
	}
	var entries []opsEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("parse ops.json: %w", err)
	}
	out := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		userId := e.UUID
		if userId == "" {
			userId = e.Name
		}
		out = append(out, map[string]interface{}{
			"uuid":                e.UUID,
			"name":                e.Name,
			"level":               e.Level,
			"userId":              userId,
			"permissionLevel":     e.Level,
			"bypassesPlayerLimit": e.BypassesPlayerLimit,
			"platform":            "minecraft",
		})
	}
	return out, nil
}
