package minecraft

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/mastermind/agent/internal/agent"
	"github.com/mastermind/agent/internal/games/minecraft/configmerge"
)

const maxModConfigBytes = 256 * 1024

var (
	modIDQuotedRe = regexp.MustCompile(`(?im)^\s*modId\s*=\s*"([^"]+)"`)
	fabricIDRe    = regexp.MustCompile(`(?i)"id"\s*:\s*"([^"]+)"`)
	versionChunk  = regexp.MustCompile(`(?i)[-_.]?(?:neoforge|forge|fabric|quilt)?[-_.]?v?\d+(?:\.\d+){0,4}.*$`)
)

var editableModConfigExtensions = map[string]bool{
	".toml": true, ".json": true, ".cfg": true, ".conf": true,
	".properties": true, ".ini": true, ".xml": true, ".snbt": true, ".txt": true,
}

func configTemplatesRoot(cfg *agent.InstanceConfig) (string, error) {
	q, err := quarantineDir(cfg, modKindMods)
	if err != nil {
		return "", err
	}
	return filepath.Join(q, ".config-templates"), nil
}

func configTemplateDir(cfg *agent.InstanceConfig, jarName string) (string, error) {
	if err := validateModEntryName(jarName); err != nil {
		return "", err
	}
	root, err := configTemplatesRoot(cfg)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, jarName), nil
}

func pathInside(root, target string) bool {
	root = filepath.Clean(root)
	target = filepath.Clean(target)
	sep := string(filepath.Separator)
	return target == root || strings.HasPrefix(target, root+sep)
}

func jarModIDs(jarPath string) ([]string, error) {
	r, err := zip.OpenReader(jarPath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	var ids []string
	seen := map[string]bool{}
	add := func(id string) {
		id = strings.TrimSpace(strings.ToLower(id))
		if id == "" || id == "minecraft" || id == "java" || id == "neoforge" || id == "forge" || id == "fabricloader" {
			return
		}
		if seen[id] {
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}

	for _, f := range r.File {
		name := strings.ReplaceAll(f.Name, "\\", "/")
		lower := strings.ToLower(name)
		switch {
		case lower == "meta-inf/neoforge.mods.toml" || lower == "meta-inf/mods.toml":
			data, err := readZipFileLimited(f, 256*1024)
			if err != nil {
				continue
			}
			for _, m := range modIDQuotedRe.FindAllStringSubmatch(string(data), -1) {
				add(m[1])
			}
		case lower == "fabric.mod.json" || strings.HasSuffix(lower, "/fabric.mod.json"):
			data, err := readZipFileLimited(f, 256*1024)
			if err != nil {
				continue
			}
			if m := fabricIDRe.FindStringSubmatch(string(data)); len(m) == 2 {
				add(m[1])
			}
		}
	}
	if len(ids) == 0 {
		ids = guessModIDsFromJarName(filepath.Base(jarPath))
	}
	sort.Strings(ids)
	return ids, nil
}

func readZipFileLimited(f *zip.File, limit int64) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, limit))
}

func guessModIDsFromJarName(name string) []string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	base = versionChunk.ReplaceAllString(base, "")
	base = strings.Trim(base, "-_. ")
	base = strings.ToLower(base)
	base = strings.ReplaceAll(base, " ", "")
	base = strings.ReplaceAll(base, "_", "")
	if base == "" {
		return nil
	}
	return []string{base}
}

func isEditableInstallConfig(rel string) bool {
	clean := filepath.ToSlash(filepath.Clean(rel))
	if clean == "." || filepath.IsAbs(clean) || strings.Contains(clean, "..") {
		return false
	}
	if !strings.HasPrefix(clean, "config/") && !strings.HasPrefix(clean, "defaultconfigs/") {
		return false
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if !editableModConfigExtensions[ext] {
		return false
	}
	base := strings.ToLower(filepath.Base(clean))
	if strings.HasPrefix(base, ".") || strings.HasSuffix(base, ".bak") {
		return false
	}
	return true
}

func listConfigFilesForModIDs(installPath string, modIDs []string) []string {
	if installPath == "" || len(modIDs) == 0 {
		return nil
	}
	idSet := map[string]bool{}
	for _, id := range modIDs {
		idSet[strings.ToLower(id)] = true
	}
	var out []string
	seen := map[string]bool{}
	addRel := func(rel string) {
		rel = filepath.ToSlash(rel)
		if !isEditableInstallConfig(rel) || seen[rel] {
			return
		}
		full := filepath.Join(installPath, filepath.FromSlash(rel))
		info, err := os.Lstat(full)
		if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > maxModConfigBytes {
			return
		}
		seen[rel] = true
		out = append(out, rel)
	}

	for id := range idSet {
		dir := filepath.Join(installPath, "config", id)
		_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil {
				return nil
			}
			if info.IsDir() {
				if path != dir && strings.HasPrefix(info.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}
			rel, relErr := filepath.Rel(installPath, path)
			if relErr != nil {
				return nil
			}
			addRel(rel)
			if len(out) >= 100 {
				return filepath.SkipAll
			}
			return nil
		})
		for _, root := range []string{"config", "defaultconfigs"} {
			entries, err := os.ReadDir(filepath.Join(installPath, root))
			if err != nil {
				continue
			}
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				name := strings.ToLower(e.Name())
				if strings.HasPrefix(name, id+".") || strings.HasPrefix(name, id+"-") {
					addRel(filepath.ToSlash(filepath.Join(root, e.Name())))
				}
			}
		}
	}
	sort.Strings(out)
	return out
}

func listTemplateConfigFiles(templateRoot string) []string {
	if templateRoot == "" {
		return nil
	}
	var out []string
	_ = filepath.Walk(templateRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 || info.Size() > maxModConfigBytes {
			return nil
		}
		rel, relErr := filepath.Rel(templateRoot, path)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !isEditableInstallConfig(rel) {
			return nil
		}
		out = append(out, rel)
		if len(out) >= 100 {
			return filepath.SkipAll
		}
		return nil
	})
	sort.Strings(out)
	return out
}

func resolveInstallConfigPath(installPath, relativePath string, allowMissing bool) (string, error) {
	if installPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(relativePath)))
	if !isEditableInstallConfig(clean) {
		return "", fmt.Errorf("invalid or unsupported mod config path")
	}
	target := filepath.Clean(filepath.Join(installPath, filepath.FromSlash(clean)))
	if !pathInside(installPath, target) {
		return "", fmt.Errorf("mod config path is outside install root")
	}
	info, err := os.Lstat(target)
	if err != nil {
		if allowMissing && os.IsNotExist(err) {
			return target, nil
		}
		return "", fmt.Errorf("mod config not found: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("mod config must be a regular file")
	}
	if info.Size() > maxModConfigBytes {
		return "", fmt.Errorf("mod config exceeds 256 KiB editor limit")
	}
	return target, nil
}

func (a *Adapter) ReadModConfig(cfg *agent.InstanceConfig, payload map[string]interface{}) (string, string, error) {
	path := strings.TrimSpace(getString(payload, "path", ""))
	target, err := resolveInstallConfigPath(cfg.InstallPath, path, false)
	if err != nil {
		return "", "", err
	}
	content, err := os.ReadFile(target)
	if err != nil {
		return "", "", fmt.Errorf("read mod config: %w", err)
	}
	return string(content), filepath.ToSlash(path), nil
}

func (a *Adapter) WriteModConfig(cfg *agent.InstanceConfig, payload map[string]interface{}) (string, error) {
	path := strings.TrimSpace(getString(payload, "path", ""))
	content := getString(payload, "content", "")
	if len(content) > maxModConfigBytes {
		return "", fmt.Errorf("mod config exceeds 256 KiB editor limit")
	}
	target, err := resolveInstallConfigPath(cfg.InstallPath, path, true)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return "", fmt.Errorf("create mod config directory: %w", err)
	}
	mode := os.FileMode(0644)
	if info, err := os.Stat(target); err == nil {
		mode = info.Mode().Perm()
	}
	tmp := target + ".mastermind-tmp"
	if err := os.WriteFile(tmp, []byte(content), mode); err != nil {
		return "", fmt.Errorf("write mod config: %w", err)
	}
	if err := os.Rename(tmp, target); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("finalize mod config: %w", err)
	}
	return filepath.ToSlash(path), nil
}

func (a *Adapter) PreviewConfigMerge(cfg *agent.InstanceConfig, payload map[string]interface{}) ([]configmerge.MergeResult, error) {
	sourceFolder := strings.TrimSpace(getString(payload, "sourceFolder", getString(payload, "source_folder", "")))
	targetFolder := strings.TrimSpace(getString(payload, "targetFolder", getString(payload, "target_folder", getString(payload, "folder", ""))))
	if sourceFolder == "" || targetFolder == "" {
		return nil, fmt.Errorf("sourceFolder and targetFolder are required")
	}
	if err := validateModEntryName(sourceFolder); err != nil {
		return nil, err
	}
	if err := validateModEntryName(targetFolder); err != nil {
		return nil, err
	}

	templateRoot, err := configTemplateDir(cfg, sourceFolder)
	if err != nil {
		return nil, err
	}
	// Ensure templates exist for this quarantined jar (best-effort).
	if _, qPath, qerr := findQuarantinedMod(cfg, sourceFolder, ""); qerr == nil {
		_ = stageConfigTemplatesForJar(cfg, qPath, sourceFolder)
	}

	var liveIDs []string
	if _, activePath, aerr := findActiveMod(cfg, targetFolder, ""); aerr == nil {
		liveIDs, _ = jarModIDs(activePath)
	}
	if len(liveIDs) == 0 {
		if _, qPath, qerr := findQuarantinedMod(cfg, sourceFolder, ""); qerr == nil {
			liveIDs, _ = jarModIDs(qPath)
		}
	}
	if len(liveIDs) == 0 {
		liveIDs = guessModIDsFromJarName(targetFolder)
	}

	liveFiles := listConfigFilesForModIDs(cfg.InstallPath, liveIDs)
	templateFiles := listTemplateConfigFiles(templateRoot)

	templateSet := map[string]bool{}
	for _, p := range templateFiles {
		templateSet[p] = true
	}
	allPaths := map[string]bool{}
	for _, p := range templateFiles {
		allPaths[p] = true
	}
	for _, p := range liveFiles {
		allPaths[p] = true
	}

	results := make([]configmerge.MergeResult, 0, len(allPaths))
	for path := range allPaths {
		templateContent := ""
		liveContent := ""
		if templateSet[path] {
			if data, err := os.ReadFile(filepath.Join(templateRoot, filepath.FromSlash(path))); err == nil {
				templateContent = string(data)
			}
		}
		if resolved, err := resolveInstallConfigPath(cfg.InstallPath, path, false); err == nil {
			if data, err := os.ReadFile(resolved); err == nil {
				liveContent = string(data)
			}
		}
		if templateContent == "" && liveContent == "" {
			continue
		}
		if templateContent == "" {
			results = append(results, configmerge.MergeResult{
				Path: path, MergedContent: liveContent, ParseFormat: "text",
				Warning: "live file has no counterpart in new mod templates; will not be modified", Skipped: true,
			})
			continue
		}
		if liveContent == "" {
			results = append(results, configmerge.MergeResult{
				Path: path, MergedContent: templateContent, TemplateContent: templateContent, ParseFormat: "text",
				Warning: "new config file from updated mod (no existing live file)",
				Stats:   configmerge.MergeStats{NewKeys: configmerge.CountNonEmptyLines(templateContent)},
			})
			continue
		}
		result := configmerge.MergeFile(path, templateContent, liveContent)
		result.TemplateContent = templateContent
		results = append(results, result)
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Path < results[j].Path })
	return results, nil
}

func (a *Adapter) ApplyConfigMerge(cfg *agent.InstanceConfig, payload map[string]interface{}) (map[string]interface{}, error) {
	files, _ := payload["files"].([]interface{})
	if len(files) == 0 {
		return nil, fmt.Errorf("no files to apply")
	}
	applied := 0
	for _, f := range files {
		entry, ok := f.(map[string]interface{})
		if !ok {
			continue
		}
		path := getString(entry, "path", "")
		content := getString(entry, "content", "")
		if path == "" || content == "" {
			continue
		}
		if _, err := a.WriteModConfig(cfg, map[string]interface{}{"path": path, "content": content}); err != nil {
			return nil, fmt.Errorf("write %s: %w", path, err)
		}
		applied++
	}
	return map[string]interface{}{"applied": applied, "folder": getString(payload, "folder", "")}, nil
}

func stageConfigTemplatesForJar(cfg *agent.InstanceConfig, jarPath, jarName string) error {
	destRoot, err := configTemplateDir(cfg, jarName)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(destRoot, 0755); err != nil {
		return err
	}
	ids, _ := jarModIDs(jarPath)
	if len(ids) == 0 {
		ids = guessModIDsFromJarName(jarName)
	}
	// 1) Extract defaultconfigs/ embedded in the jar (rare but ideal).
	_ = extractJarDefaultConfigs(jarPath, destRoot)
	// 2) Snapshot matching pack defaultconfigs into config/ paths for merge templates.
	for _, rel := range listConfigFilesForModIDs(cfg.InstallPath, ids) {
		if !strings.HasPrefix(rel, "defaultconfigs/") {
			continue
		}
		src := filepath.Join(cfg.InstallPath, filepath.FromSlash(rel))
		mapped := "config/" + strings.TrimPrefix(rel, "defaultconfigs/")
		dst := filepath.Join(destRoot, filepath.FromSlash(mapped))
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			continue
		}
		_ = copyFile(src, dst)
	}
	// 3) Also copy live config files as templates when no template yet (keeps merge useful for same-version compare).
	for _, rel := range listConfigFilesForModIDs(cfg.InstallPath, ids) {
		if !strings.HasPrefix(rel, "config/") {
			continue
		}
		dst := filepath.Join(destRoot, filepath.FromSlash(rel))
		if _, err := os.Lstat(dst); err == nil {
			continue
		}
		src := filepath.Join(cfg.InstallPath, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			continue
		}
		_ = copyFile(src, dst)
	}
	return nil
}

func extractJarDefaultConfigs(jarPath, destRoot string) error {
	r, err := zip.OpenReader(jarPath)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		name := filepath.ToSlash(f.Name)
		lower := strings.ToLower(name)
		var rel string
		switch {
		case strings.HasPrefix(lower, "defaultconfigs/"):
			rel = "config/" + name[len("defaultconfigs/"):]
		case strings.HasPrefix(lower, "config/") && !strings.Contains(lower, ".class"):
			rel = name
		default:
			continue
		}
		rel = filepath.ToSlash(rel)
		if f.FileInfo().IsDir() || !isEditableInstallConfig(rel) {
			continue
		}
		dst := filepath.Join(destRoot, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			rc.Close()
			continue
		}
		_, _ = io.Copy(out, io.LimitReader(rc, maxModConfigBytes+1))
		_ = out.Close()
		_ = rc.Close()
	}
	return nil
}

func enrichModRecord(cfg *agent.InstanceConfig, item map[string]interface{}, jarPath string, activeByID map[string]string, parseJar bool) {
	name, _ := item["folder"].(string)
	if name == "" {
		name, _ = item["name"].(string)
	}
	if info, ok := item["modTime"]; ok {
		item["activatedAt"] = info
	} else if item["activatedAt"] == nil {
		item["activatedAt"] = ""
	}
	var ids []string
	if parseJar {
		ids, _ = jarModIDs(jarPath)
	}
	if len(ids) == 0 {
		ids = guessModIDsFromJarName(name)
	}
	if len(ids) > 0 {
		item["modIds"] = ids
		item["version"] = firstNonEmpty(item["version"], guessVersionFromJarName(name))
	}
	configs := listConfigFilesForModIDs(cfg.InstallPath, ids)
	if len(configs) > 0 {
		item["configFiles"] = configs
	}
	if activeByID == nil {
		return
	}
	for _, id := range ids {
		if active, ok := activeByID[id]; ok {
			item["conflictsWithActive"] = true
			item["restoreTarget"] = active
			item["overrideActive"] = true
			item["transferConfig"] = true
			return
		}
	}
	if active, ok := activeByID["name:"+strings.ToLower(name)]; ok {
		item["conflictsWithActive"] = true
		item["restoreTarget"] = active
		item["overrideActive"] = true
		item["transferConfig"] = true
		return
	}
}

func firstNonEmpty(values ...interface{}) string {
	for _, v := range values {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

func guessVersionFromJarName(name string) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	re := regexp.MustCompile(`(?i)(\d+(?:\.\d+){1,4})`)
	matches := re.FindAllString(base, -1)
	if len(matches) == 0 {
		return ""
	}
	return matches[len(matches)-1]
}

func buildActiveModIDIndex(cfg *agent.InstanceConfig) map[string]string {
	out := map[string]string{}
	for _, kind := range []string{modKindMods, modKindPlugins} {
		dir, err := activeDir(cfg, kind)
		if err != nil {
			continue
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := e.Name()
			if strings.HasPrefix(name, ".") || e.IsDir() {
				continue
			}
			ids := guessModIDsFromJarName(name)
			for _, id := range ids {
				if _, exists := out[id]; !exists {
					out[id] = name
				}
			}
			// Also index exact folder name lowercased for filename matches.
			out["name:"+strings.ToLower(name)] = name
		}
	}
	return out
}
