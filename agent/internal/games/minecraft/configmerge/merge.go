// Package configmerge provides template-safe config merging for Minecraft / NeoForge mod
// config files. The merge is additive: it starts from the new template and
// carries forward live values only for keys/elements that exist in the
// template. Keys removed from the new version are intentionally dropped.
package configmerge

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

// MergeStats tracks what happened during a single file merge.
type MergeStats struct {
	Carried int `json:"carried"` // live values applied to matching template keys
	NewKeys int `json:"newKeys"` // keys only in template (kept as default)
	Dropped int `json:"dropped"` // keys only in live (intentionally dropped)
}

// MergeResult is the output for one config file.
type MergeResult struct {
	Path            string     `json:"path"`
	MergedContent   string     `json:"mergedContent"`
	TemplateContent string     `json:"templateContent,omitempty"` // new-mod defaults (unmerged)
	Stats           MergeStats `json:"stats"`
	ParseFormat     string     `json:"parseFormat"` // "xml", "json", "ini", "text"
	Warning         string     `json:"warning,omitempty"`
	Skipped         bool       `json:"skipped,omitempty"`
}

// MergeFile merges a live config file with a new template. The template is the
// authority: only keys present in the template survive in the output.
func MergeFile(path, templateContent, liveContent string) MergeResult {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".xml":
		return mergeXML(path, templateContent, liveContent)
	case ".json":
		return mergeJSON(path, templateContent, liveContent)
	case ".ini", ".cfg", ".conf", ".toml", ".properties":
		return mergeINI(path, templateContent, liveContent)
	default:
		return MergeResult{
			Path:          path,
			MergedContent: templateContent,
			ParseFormat:   "text",
			Warning:       fmt.Sprintf("no auto-merge for %s files; using new template defaults", ext),
			Skipped:       true,
			Stats:         MergeStats{NewKeys: CountNonEmptyLines(templateContent)},
		}
	}
}

// CountNonEmptyLines returns the number of non-blank lines in s.
func CountNonEmptyLines(s string) int {
	n := 0
	for _, line := range strings.Split(s, "\n") {
		if strings.TrimSpace(line) != "" {
			n++
		}
	}
	return n
}

// mergeJSON does a deep, template-safe merge of two JSON documents.
func mergeJSON(path, templateContent, liveContent string) MergeResult {
	var tmpl, live interface{}
	if err := json.Unmarshal([]byte(templateContent), &tmpl); err != nil {
		return MergeResult{
			Path: path, MergedContent: templateContent, ParseFormat: "json",
			Warning: "template JSON parse failed: " + err.Error(), Skipped: true,
		}
	}
	if err := json.Unmarshal([]byte(liveContent), &live); err != nil {
		return MergeResult{
			Path: path, MergedContent: templateContent, ParseFormat: "json",
			Warning: "live JSON parse failed: " + err.Error(), Skipped: true,
		}
	}
	stats := MergeStats{}
	merged := mergeJSONValue(tmpl, live, &stats)
	out, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return MergeResult{
			Path: path, MergedContent: templateContent, ParseFormat: "json",
			Warning: "failed to serialize merged JSON: " + err.Error(), Skipped: true,
		}
	}
	// Count dropped: keys in live top-level not in template
	if liveMap, ok := live.(map[string]interface{}); ok {
		if tmplMap, ok := tmpl.(map[string]interface{}); ok {
			stats.Dropped = countDroppedKeys(tmplMap, liveMap)
		}
	}
	return MergeResult{
		Path: path, MergedContent: string(out) + "\n", ParseFormat: "json", Stats: stats,
	}
}

func mergeJSONValue(tmpl, live interface{}, stats *MergeStats) interface{} {
	tmplMap, tmplIsMap := tmpl.(map[string]interface{})
	liveMap, liveIsMap := live.(map[string]interface{})
	if tmplIsMap && liveIsMap {
		result := make(map[string]interface{}, len(tmplMap))
		for key, tmplVal := range tmplMap {
			if liveVal, exists := liveMap[key]; exists {
				result[key] = mergeJSONValue(tmplVal, liveVal, stats)
			} else {
				result[key] = tmplVal
				stats.NewKeys++
			}
		}
		return result
	}
	// For leaf values or type mismatches: if same type, carry live; otherwise keep template
	if tmpl == nil || live == nil {
		if live != nil && tmpl != nil {
			stats.Carried++
			return live
		}
		if live == nil {
			stats.NewKeys++
		}
		return tmpl
	}
	tmplType := fmt.Sprintf("%T", tmpl)
	liveType := fmt.Sprintf("%T", live)
	if tmplType == liveType {
		stats.Carried++
		return live
	}
	// Type mismatch: keep template default
	stats.NewKeys++
	return tmpl
}

func countDroppedKeys(tmpl, live map[string]interface{}) int {
	dropped := 0
	for key, liveVal := range live {
		if _, exists := tmpl[key]; !exists {
			dropped++
		} else if liveChild, ok := liveVal.(map[string]interface{}); ok {
			if tmplChild, ok := tmpl[key].(map[string]interface{}); ok {
				dropped += countDroppedKeys(tmplChild, liveChild)
			}
		}
	}
	return dropped
}
