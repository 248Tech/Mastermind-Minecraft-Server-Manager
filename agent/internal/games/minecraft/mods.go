package minecraft

import (
	"archive/zip"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

var safeModNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+\- ]{0,199}$`)

const (
	modKindMods    = "mods"
	modKindPlugins = "plugins"
)

func validateModEntryName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("mod name required")
	}
	if name != filepath.Base(name) || strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("unsafe mod name")
	}
	if strings.HasPrefix(name, ".") {
		return fmt.Errorf("hidden mod names are not allowed")
	}
	if !safeModNameRe.MatchString(name) {
		return fmt.Errorf("invalid mod name")
	}
	return nil
}

func payloadModName(payload map[string]interface{}) string {
	name := strings.TrimSpace(getString(payload, "name", getString(payload, "folder", getString(payload, "filename", getString(payload, "path", "")))))
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	return name
}

func payloadModKind(payload map[string]interface{}) string {
	kind := strings.ToLower(strings.TrimSpace(getString(payload, "kind", getString(payload, "folder_type", getString(payload, "target", "")))))
	switch kind {
	case modKindMods, modKindPlugins:
		return kind
	}
	rawPath := strings.ToLower(strings.ReplaceAll(getString(payload, "path", ""), "\\", "/"))
	if strings.HasPrefix(rawPath, "plugins/") || strings.Contains(rawPath, "/plugins/") {
		return modKindPlugins
	}
	if strings.HasPrefix(rawPath, "mods/") || strings.Contains(rawPath, "/mods/") {
		return modKindMods
	}
	return ""
}

func activeDir(cfg *agent.InstanceConfig, kind string) (string, error) {
	if cfg.InstallPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	switch kind {
	case modKindMods, modKindPlugins:
		return filepath.Join(cfg.InstallPath, kind), nil
	default:
		return "", fmt.Errorf("mod kind must be mods or plugins")
	}
}

func quarantineDir(cfg *agent.InstanceConfig, kind string) (string, error) {
	root, err := activeDir(cfg, kind)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, ".quarantine"), nil
}

func pendingDir(cfg *agent.InstanceConfig) (string, error) {
	root, err := activeDir(cfg, modKindMods)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, ".pending"), nil
}

func listDirEntries(dir, kind, pathPrefix string) ([]map[string]interface{}, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []map[string]interface{}{}, nil
		}
		return nil, err
	}
	out := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		info, _ := e.Info()
		// folder is the UI primary key (jar/folder name); kind is mods|plugins.
		item := map[string]interface{}{
			"name":   name,
			"folder": name,
			"kind":   kind,
			"path":   pathPrefix + "/" + name,
			"dir":    e.IsDir(),
		}
		if info != nil {
			item["size"] = info.Size()
			item["modTime"] = info.ModTime().UTC().Format(time.RFC3339)
		}
		out = append(out, item)
	}
	return out, nil
}

func (a *Adapter) ListQuarantinedMods(cfg *agent.InstanceConfig, payload map[string]interface{}) ([]map[string]interface{}, error) {
	kindFilter := payloadModKind(payload)
	kinds := []string{modKindMods, modKindPlugins}
	if kindFilter != "" {
		kinds = []string{kindFilter}
	}
	activeByID := buildActiveModIDIndex(cfg)
	var out []map[string]interface{}
	for _, kind := range kinds {
		dir, err := quarantineDir(cfg, kind)
		if err != nil {
			return nil, err
		}
		items, err := listDirEntries(dir, kind, kind+"/.quarantine")
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			name, _ := item["folder"].(string)
			path := filepath.Join(dir, name)
			if strings.HasSuffix(strings.ToLower(name), ".jar") {
				_ = stageConfigTemplatesForJar(cfg, path, name)
				enrichModRecord(cfg, item, path, activeByID, true)
			}
			if item["activatedAt"] == nil {
				item["activatedAt"] = item["modTime"]
			}
			out = append(out, item)
		}
	}
	if out == nil {
		out = []map[string]interface{}{}
	}
	return out, nil
}

func (a *Adapter) ListPendingMods(cfg *agent.InstanceConfig) ([]map[string]interface{}, error) {
	dir, err := pendingDir(cfg)
	if err != nil {
		return nil, err
	}
	return listDirEntries(dir, modKindMods, "mods/.pending")
}

func findActiveMod(cfg *agent.InstanceConfig, name, preferredKind string) (kind, path string, err error) {
	if err := validateModEntryName(name); err != nil {
		return "", "", err
	}
	kinds := []string{modKindMods, modKindPlugins}
	if preferredKind != "" {
		kinds = []string{preferredKind}
	}
	for _, k := range kinds {
		root, err := activeDir(cfg, k)
		if err != nil {
			return "", "", err
		}
		candidate := filepath.Join(root, name)
		if info, err := os.Lstat(candidate); err == nil && info.Mode()&os.ModeSymlink == 0 {
			return k, candidate, nil
		}
	}
	return "", "", fmt.Errorf("mod not found in active mods/plugins: %s", name)
}

func findQuarantinedMod(cfg *agent.InstanceConfig, name, preferredKind string) (kind, path string, err error) {
	if err := validateModEntryName(name); err != nil {
		return "", "", err
	}
	kinds := []string{modKindMods, modKindPlugins}
	if preferredKind != "" {
		kinds = []string{preferredKind}
	}
	for _, k := range kinds {
		root, err := quarantineDir(cfg, k)
		if err != nil {
			return "", "", err
		}
		candidate := filepath.Join(root, name)
		if info, err := os.Lstat(candidate); err == nil && info.Mode()&os.ModeSymlink == 0 {
			return k, candidate, nil
		}
	}
	return "", "", fmt.Errorf("mod not found in quarantine: %s", name)
}

func (a *Adapter) QuarantineMod(cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	name := payloadModName(payload)
	kind, src, err := findActiveMod(cfg, name, payloadModKind(payload))
	if err != nil {
		return nil, err
	}
	qdir, err := quarantineDir(cfg, kind)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(qdir, 0755); err != nil {
		return nil, err
	}
	dest := filepath.Join(qdir, name)
	if _, err := os.Lstat(dest); !os.IsNotExist(err) {
		return nil, fmt.Errorf("quarantined mod already exists: %s", name)
	}
	if err := os.Rename(src, dest); err != nil {
		return nil, fmt.Errorf("quarantine mod: %w", err)
	}
	_ = stageConfigTemplatesForJar(cfg, dest, name)
	return map[string]interface{}{"quarantined": name, "folder": name, "kind": kind}, nil
}

func (a *Adapter) RestoreMod(cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	name := payloadModName(payload)
	kind, src, err := findQuarantinedMod(cfg, name, payloadModKind(payload))
	if err != nil {
		return nil, err
	}
	active, err := activeDir(cfg, kind)
	if err != nil {
		return nil, err
	}
	dest := filepath.Join(active, name)
	if _, err := os.Lstat(dest); !os.IsNotExist(err) {
		if !getBool(payload, "forceOverride") && !getBool(payload, "force_override") {
			return nil, fmt.Errorf("active mod already exists: %s", name)
		}
		if err := os.RemoveAll(dest); err != nil {
			return nil, fmt.Errorf("remove active mod for override: %w", err)
		}
	}
	if err := os.Rename(src, dest); err != nil {
		return nil, fmt.Errorf("restore mod: %w", err)
	}
	return map[string]interface{}{"restored": name, "restoredAs": name, "folder": name, "kind": kind}, nil
}

func (a *Adapter) DeleteMod(cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	name := payloadModName(payload)
	if err := validateModEntryName(name); err != nil {
		return nil, err
	}
	source := strings.ToLower(strings.TrimSpace(getString(payload, "source", "")))
	rawPath := strings.ToLower(strings.ReplaceAll(getString(payload, "path", ""), "\\", "/"))
	if source == "" {
		switch {
		case strings.Contains(rawPath, ".quarantine"):
			source = "quarantine"
		case strings.Contains(rawPath, ".pending"):
			source = "pending"
		default:
			source = "active"
		}
	}
	kindHint := payloadModKind(payload)
	var path string
	var kind string
	var err error
	switch source {
	case "quarantine", "quarantined":
		kind, path, err = findQuarantinedMod(cfg, name, kindHint)
	case "pending":
		root, perr := pendingDir(cfg)
		if perr != nil {
			return nil, perr
		}
		path = filepath.Join(root, name)
		kind = "mods/.pending"
		if info, lerr := os.Lstat(path); lerr != nil || info.Mode()&os.ModeSymlink != 0 {
			err = fmt.Errorf("pending mod not found: %s", name)
		}
	default:
		source = "active"
		kind, path, err = findActiveMod(cfg, name, kindHint)
	}
	if err != nil {
		return nil, err
	}
	if err := os.RemoveAll(path); err != nil {
		return nil, fmt.Errorf("delete mod: %w", err)
	}
	return map[string]interface{}{"deleted": name, "source": source, "folder": kind}, nil
}

func (a *Adapter) UploadMod(cfg *agent.InstanceConfig, payload map[string]interface{}, pending bool) (map[string]interface{}, error) {
	filename := strings.TrimSpace(getString(payload, "filename", getString(payload, "originalName", getString(payload, "name", ""))))
	if filename == "" {
		filename = "uploaded-mod.jar"
	}
	filename = filepath.Base(filename)
	kind := payloadModKind(payload)
	if kind == "" {
		kind = modKindMods
	}
	var destRoot string
	var err error
	if pending {
		destRoot, err = pendingDir(cfg)
	} else {
		destRoot, err = quarantineDir(cfg, kind)
	}
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(destRoot, 0755); err != nil {
		return nil, err
	}

	sourcePath := strings.TrimSpace(getString(payload, "source_path", getString(payload, "archive_path", "")))
	b64 := strings.TrimSpace(getString(payload, "base64", getString(payload, "contentBase64", "")))

	var folders []string
	switch {
	case sourcePath != "" && (strings.HasSuffix(strings.ToLower(sourcePath), ".zip") || strings.HasSuffix(strings.ToLower(filename), ".zip")):
		folders, err = extractJarsFromZip(sourcePath, destRoot)
		if err != nil {
			return nil, err
		}
	case sourcePath != "":
		if err := validateModEntryName(filename); err != nil {
			return nil, err
		}
		dest := filepath.Join(destRoot, filename)
		if _, err := os.Lstat(dest); !os.IsNotExist(err) {
			return nil, fmt.Errorf("mod already exists: %s", filename)
		}
		if err := copyFile(sourcePath, dest); err != nil {
			return nil, err
		}
		folders = []string{filename}
	case b64 != "":
		if err := validateModEntryName(filename); err != nil {
			return nil, err
		}
		dest := filepath.Join(destRoot, filename)
		if _, err := os.Lstat(dest); !os.IsNotExist(err) {
			return nil, fmt.Errorf("mod already exists: %s", filename)
		}
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("decode base64: %w", err)
		}
		if err := os.WriteFile(dest, data, 0644); err != nil {
			return nil, err
		}
		folders = []string{filename}
	default:
		return nil, fmt.Errorf("source_path, archive_path, or base64 required")
	}

	result := map[string]interface{}{
		"folders": folders,
		"count":   len(folders),
		"name":    filename,
		"kind":    kind,
	}
	if pending {
		result["pending"] = true
	} else {
		result["quarantined"] = true
		result["folder"] = folders[0]
		stageUploadedJars(cfg, destRoot, folders)
	}
	return result, nil
}

func extractJarsFromZip(zipPath, destRoot string) ([]string, error) {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	defer r.Close()
	var folders []string
	for _, f := range r.File {
		name := filepath.Base(f.Name)
		if f.FileInfo().IsDir() || !strings.HasSuffix(strings.ToLower(name), ".jar") {
			continue
		}
		if err := validateModEntryName(name); err != nil {
			continue
		}
		dest := filepath.Join(destRoot, name)
		if _, err := os.Lstat(dest); !os.IsNotExist(err) {
			return nil, fmt.Errorf("mod already exists: %s", name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0644)
		if err != nil {
			rc.Close()
			return nil, err
		}
		_, copyErr := io.Copy(out, rc)
		_ = out.Close()
		_ = rc.Close()
		if copyErr != nil {
			_ = os.Remove(dest)
			return nil, copyErr
		}
		folders = append(folders, name)
	}
	if len(folders) == 0 {
		return nil, fmt.Errorf("zip contained no .jar mods")
	}
	return folders, nil
}

func stageUploadedJars(cfg *agent.InstanceConfig, destRoot string, folders []string) {
	for _, name := range folders {
		_ = stageConfigTemplatesForJar(cfg, filepath.Join(destRoot, name), name)
	}
}

func (a *Adapter) ApprovePendingMod(cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	name := payloadModName(payload)
	if err := validateModEntryName(name); err != nil {
		return nil, err
	}
	pendingRoot, err := pendingDir(cfg)
	if err != nil {
		return nil, err
	}
	src := filepath.Join(pendingRoot, name)
	if info, err := os.Lstat(src); err != nil || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("pending mod not found: %s", name)
	}
	kind := payloadModKind(payload)
	if kind == "" {
		kind = modKindMods
	}
	active, err := activeDir(cfg, kind)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(active, 0755); err != nil {
		return nil, err
	}
	dest := filepath.Join(active, name)
	if _, err := os.Lstat(dest); !os.IsNotExist(err) {
		return nil, fmt.Errorf("active mod already exists: %s", name)
	}
	if err := os.Rename(src, dest); err != nil {
		return nil, fmt.Errorf("approve pending mod: %w", err)
	}
	return map[string]interface{}{"approved": name, "folder": name, "kind": kind}, nil
}

func (a *Adapter) RejectPendingMod(cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	name := payloadModName(payload)
	if err := validateModEntryName(name); err != nil {
		return nil, err
	}
	pendingRoot, err := pendingDir(cfg)
	if err != nil {
		return nil, err
	}
	target := filepath.Join(pendingRoot, name)
	if info, err := os.Lstat(target); err != nil || info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("pending mod not found: %s", name)
	}
	if err := os.RemoveAll(target); err != nil {
		return nil, fmt.Errorf("reject pending mod: %w", err)
	}
	return map[string]interface{}{"rejected": name}, nil
}

func copyFile(src, dst string) error {
	info, err := os.Lstat(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("source must be a regular file")
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(dst)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(dst)
		return closeErr
	}
	return nil
}
