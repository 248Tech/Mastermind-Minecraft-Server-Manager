package configmerge

import (
	"strings"
)

// mergeINI does a section-aware, template-safe merge of INI/properties/TOML-like files.
// Only keys present in template sections survive. Live-only sections/keys are dropped.
func mergeINI(path, templateContent, liveContent string) MergeResult {
	tmplSections, tmplErr := parseINI(templateContent)
	if tmplErr != "" {
		return MergeResult{
			Path: path, MergedContent: templateContent, ParseFormat: "ini",
			Warning: "template INI parse issue: " + tmplErr, Skipped: true,
		}
	}
	liveSections, liveErr := parseINI(liveContent)
	if liveErr != "" {
		return MergeResult{
			Path: path, MergedContent: templateContent, ParseFormat: "ini",
			Warning: "live INI parse issue: " + liveErr, Skipped: true,
		}
	}

	stats := MergeStats{}
	liveIndex := make(map[string]*iniSection, len(liveSections))
	for _, sec := range liveSections {
		liveIndex[strings.ToLower(sec.Name)] = sec
	}

	var out strings.Builder
	for _, tmplSec := range tmplSections {
		liveSec := liveIndex[strings.ToLower(tmplSec.Name)]
		if tmplSec.Name != "" {
			out.WriteString("[" + tmplSec.Name + "]\n")
		}
		liveKV := map[string]string{}
		if liveSec != nil {
			for _, kv := range liveSec.Entries {
				if kv.Key != "" {
					liveKV[strings.ToLower(kv.Key)] = kv.Value
				}
			}
		}
		for _, entry := range tmplSec.Entries {
			if entry.IsComment {
				out.WriteString(entry.Raw + "\n")
				continue
			}
			if entry.IsBlank {
				out.WriteString("\n")
				continue
			}
			if liveVal, exists := liveKV[strings.ToLower(entry.Key)]; exists {
				if liveVal != entry.Value {
					stats.Carried++
				}
				out.WriteString(entry.Key + entry.Sep + liveVal + "\n")
			} else {
				stats.NewKeys++
				out.WriteString(entry.Raw + "\n")
			}
		}
	}

	// Count dropped keys
	tmplKeySet := make(map[string]map[string]bool)
	for _, sec := range tmplSections {
		secKey := strings.ToLower(sec.Name)
		if tmplKeySet[secKey] == nil {
			tmplKeySet[secKey] = make(map[string]bool)
		}
		for _, e := range sec.Entries {
			if e.Key != "" {
				tmplKeySet[secKey][strings.ToLower(e.Key)] = true
			}
		}
	}
	for _, sec := range liveSections {
		secKey := strings.ToLower(sec.Name)
		tmplKeys := tmplKeySet[secKey]
		for _, e := range sec.Entries {
			if e.Key == "" {
				continue
			}
			if tmplKeys == nil || !tmplKeys[strings.ToLower(e.Key)] {
				stats.Dropped++
			}
		}
	}

	return MergeResult{
		Path: path, MergedContent: out.String(), ParseFormat: "ini", Stats: stats,
	}
}

type iniEntry struct {
	Key       string
	Value     string
	Sep       string // "=" or ": " etc
	Raw       string
	IsComment bool
	IsBlank   bool
}

type iniSection struct {
	Name    string
	Entries []iniEntry
}

func parseINI(content string) ([]*iniSection, string) {
	lines := strings.Split(content, "\n")
	sections := []*iniSection{{Name: ""}} // global section
	current := sections[0]
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			current.Entries = append(current.Entries, iniEntry{IsBlank: true, Raw: line})
			continue
		}
		if trimmed[0] == '#' || trimmed[0] == ';' {
			current.Entries = append(current.Entries, iniEntry{IsComment: true, Raw: line})
			continue
		}
		if trimmed[0] == '[' {
			end := strings.Index(trimmed, "]")
			if end < 0 {
				current.Entries = append(current.Entries, iniEntry{IsComment: true, Raw: line})
				continue
			}
			name := strings.TrimSpace(trimmed[1:end])
			sec := &iniSection{Name: name}
			sections = append(sections, sec)
			current = sec
			continue
		}
		// Key = value or key: value
		idx := strings.Index(trimmed, "=")
		if idx < 0 {
			idx = strings.Index(trimmed, ":")
		}
		if idx < 0 {
			// Bare key or unparseable
			current.Entries = append(current.Entries, iniEntry{IsComment: true, Raw: line})
			continue
		}
		key := strings.TrimSpace(trimmed[:idx])
		val := strings.TrimSpace(trimmed[idx+1:])
		// Preserve whitespace around the separator (e.g. " = " or "=")
		sepStart := len(key)
		sepEnd := idx + 1
		for sepEnd < len(trimmed) && trimmed[sepEnd] == ' ' {
			sepEnd++
		}
		actualSep := trimmed[sepStart:sepEnd]
		current.Entries = append(current.Entries, iniEntry{
			Key: key, Value: val, Sep: actualSep, Raw: line,
		})
	}
	return sections, ""
}
