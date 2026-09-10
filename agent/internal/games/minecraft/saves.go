package minecraft

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

var validBackupIDRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+\-]{0,199}$`)

func backupRoot(cfg *agent.InstanceConfig, payload map[string]interface{}) (string, error) {
	if p := getString(payload, "backup_dir", ""); p != "" {
		return p, nil
	}
	if cfg.InstallPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	return filepath.Join(cfg.InstallPath, "mastermind-backups"), nil
}

func validateBackupID(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("save_id required")
	}
	if id != filepath.Base(id) || strings.Contains(id, "..") {
		return fmt.Errorf("unsafe save_id")
	}
	if !validBackupIDRe.MatchString(id) {
		return fmt.Errorf("invalid save_id")
	}
	return nil
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.Walk(root, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		total += info.Size()
		return nil
	})
	return total
}

func (a *Adapter) ListSaves(cfg *agent.InstanceConfig, payload map[string]interface{}) ([]map[string]interface{}, error) {
	root, err := backupRoot(cfg, payload)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return []map[string]interface{}{}, nil
		}
		return nil, fmt.Errorf("read save backups: %w", err)
	}
	saves := make([]map[string]interface{}, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || !validBackupIDRe.MatchString(entry.Name()) {
			continue
		}
		path := filepath.Join(root, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		saves = append(saves, map[string]interface{}{
			"id":        entry.Name(),
			"createdAt": info.ModTime().UTC().Format(time.RFC3339),
			"kind":      "full-world",
			"sizeBytes": directorySize(path),
			"path":      path,
		})
	}
	sort.Slice(saves, func(i, j int) bool {
		return saves[i]["createdAt"].(string) > saves[j]["createdAt"].(string)
	})
	return saves, nil
}

func (a *Adapter) RestoreSave(ctx context.Context, cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	id := strings.TrimSpace(getString(payload, "save_id", getString(payload, "backup", getString(payload, "id", ""))))
	if err := validateBackupID(id); err != nil {
		return nil, err
	}
	root, err := backupRoot(cfg, payload)
	if err != nil {
		return nil, err
	}
	source := filepath.Join(root, id)
	info, err := os.Lstat(source)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("save backup not found")
	}

	// Stop and leave stopped after restore.
	_ = a.Stop(ctx, cfg)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(3 * time.Second):
	}

	world, err := a.worldPath(cfg, payload)
	if err != nil {
		return nil, err
	}
	old := world + ".mastermind-restore-old"
	_ = os.RemoveAll(old)
	if _, err := os.Stat(world); err == nil {
		if err := os.Rename(world, old); err != nil {
			return nil, fmt.Errorf("stage current world: %w", err)
		}
	}
	if err := copyDir(source, world); err != nil {
		_ = os.RemoveAll(world)
		_ = os.Rename(old, world)
		return nil, fmt.Errorf("restore save: %w", err)
	}
	_ = os.RemoveAll(old)

	// Companion dims: if backup included them as siblings, leave as-is;
	// BackupWorld only copies the primary world folder.
	return map[string]interface{}{
		"save":          map[string]interface{}{"id": id, "path": source},
		"serverStopped": true,
		"world":         world,
	}, nil
}

func (a *Adapter) DeleteSaveBackup(cfg *agent.InstanceConfig, payload map[string]interface{}) error {
	id := strings.TrimSpace(getString(payload, "save_id", getString(payload, "backup", getString(payload, "id", ""))))
	if err := validateBackupID(id); err != nil {
		return err
	}
	root, err := backupRoot(cfg, payload)
	if err != nil {
		return err
	}
	path := filepath.Join(root, id)
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("save backup not found")
	}
	if err := os.RemoveAll(path); err != nil {
		return fmt.Errorf("delete save backup: %w", err)
	}
	return nil
}

func (a *Adapter) PruneSaveBackups(cfg *agent.InstanceConfig, payload map[string]interface{}, retention int) error {
	if retention < 1 || retention > 100 {
		return fmt.Errorf("retention count must be between 1 and 100")
	}
	root, err := backupRoot(cfg, payload)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	type item struct {
		name    string
		modTime time.Time
	}
	ids := make([]item, 0)
	for _, entry := range entries {
		if !entry.IsDir() || !validBackupIDRe.MatchString(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		ids = append(ids, item{name: entry.Name(), modTime: info.ModTime()})
	}
	sort.Slice(ids, func(i, j int) bool {
		return ids[i].modTime.After(ids[j].modTime)
	})
	if len(ids) <= retention {
		return nil
	}
	for _, id := range ids[retention:] {
		if err := os.RemoveAll(filepath.Join(root, id.name)); err != nil {
			return err
		}
	}
	return nil
}
