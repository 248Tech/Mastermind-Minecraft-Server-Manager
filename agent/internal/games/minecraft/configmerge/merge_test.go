package configmerge

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMergeJSON_CarryOverAndDrop(t *testing.T) {
	template := `{
  "maxPlayers": 8,
  "pvp": false,
  "newSetting": "default",
  "nested": {
    "a": 1,
    "b": 2
  }
}`
	live := `{
  "maxPlayers": 32,
  "pvp": true,
  "oldSetting": "custom",
  "nested": {
    "a": 100,
    "c": 999
  }
}`
	result := MergeFile("config.json", template, live)
	if result.Skipped {
		t.Fatalf("expected merge, got skipped: %s", result.Warning)
	}
	if result.ParseFormat != "json" {
		t.Fatalf("expected json, got %s", result.ParseFormat)
	}
	var merged map[string]interface{}
	if err := json.Unmarshal([]byte(result.MergedContent), &merged); err != nil {
		t.Fatal(err)
	}
	// Carried: maxPlayers=32, pvp=true, nested.a=100
	if merged["maxPlayers"] != float64(32) {
		t.Errorf("maxPlayers should be 32, got %v", merged["maxPlayers"])
	}
	if merged["pvp"] != true {
		t.Errorf("pvp should be true, got %v", merged["pvp"])
	}
	// New: newSetting kept as default
	if merged["newSetting"] != "default" {
		t.Errorf("newSetting should be 'default', got %v", merged["newSetting"])
	}
	// Dropped: oldSetting not in output
	if _, exists := merged["oldSetting"]; exists {
		t.Error("oldSetting should be dropped")
	}
	// Nested: a carried, b kept as new, c dropped
	nested := merged["nested"].(map[string]interface{})
	if nested["a"] != float64(100) {
		t.Errorf("nested.a should be 100, got %v", nested["a"])
	}
	if nested["b"] != float64(2) {
		t.Errorf("nested.b should be 2 (template default), got %v", nested["b"])
	}
	if _, exists := nested["c"]; exists {
		t.Error("nested.c should be dropped")
	}
	// Stats
	if result.Stats.Dropped < 2 {
		t.Errorf("expected at least 2 dropped (oldSetting + nested.c), got %d", result.Stats.Dropped)
	}
	if result.Stats.Carried < 3 {
		t.Errorf("expected at least 3 carried, got %d", result.Stats.Carried)
	}
}

func TestMergeJSON_TypeMismatch(t *testing.T) {
	template := `{"count": 5}`
	live := `{"count": "not a number"}`
	result := MergeFile("test.json", template, live)
	var merged map[string]interface{}
	if err := json.Unmarshal([]byte(result.MergedContent), &merged); err != nil {
		t.Fatal(err)
	}
	// Type mismatch: keep template
	if merged["count"] != float64(5) {
		t.Errorf("count should be 5 (template), got %v", merged["count"])
	}
}

func TestMergeJSON_MalformedTemplate(t *testing.T) {
	result := MergeFile("bad.json", "not json{", `{"a":1}`)
	if !result.Skipped {
		t.Error("expected skipped for malformed template")
	}
}

func TestMergeXML_CarryOverAndDrop(t *testing.T) {
	template := `<?xml version="1.0" encoding="utf-8"?>
<ServerToolsConfig>
  <Tool name="ChatCommands" enabled="true" prefix="/" />
  <Tool name="NewFeature" enabled="false" cooldown="30" />
</ServerToolsConfig>`
	live := `<?xml version="1.0" encoding="utf-8"?>
<ServerToolsConfig>
  <Tool name="ChatCommands" enabled="false" prefix="!" />
  <Tool name="OldFeature" enabled="true" />
</ServerToolsConfig>`
	result := MergeFile("ServerToolsConfig.xml", template, live)
	if result.Skipped {
		t.Fatalf("expected merge, got skipped: %s", result.Warning)
	}
	// ChatCommands: enabled carried to "false", prefix carried to "!"
	if !strings.Contains(result.MergedContent, `enabled="false"`) {
		t.Error("ChatCommands enabled should be carried as 'false'")
	}
	if !strings.Contains(result.MergedContent, `prefix="!"`) {
		t.Error("ChatCommands prefix should be carried as '!'")
	}
	// NewFeature: present (from template)
	if !strings.Contains(result.MergedContent, `name="NewFeature"`) {
		t.Error("NewFeature should be present from template")
	}
	// OldFeature: dropped
	if strings.Contains(result.MergedContent, `OldFeature`) {
		t.Error("OldFeature should be dropped")
	}
	if result.Stats.Dropped < 1 {
		t.Errorf("expected at least 1 dropped, got %d", result.Stats.Dropped)
	}
}

func TestMergeXML_MalformedLive(t *testing.T) {
	template := `<Config><Item name="a" /></Config>`
	result := MergeFile("test.xml", template, "not xml<<<")
	if !result.Skipped {
		t.Error("expected skipped for malformed live XML")
	}
}

func TestMergeINI_CarryOverAndDrop(t *testing.T) {
	template := `[General]
maxPlayers = 8
pvp = false
newSetting = default

[Advanced]
timeout = 30`
	live := `[General]
maxPlayers = 32
pvp = true
oldSetting = legacy

[Advanced]
timeout = 60
deprecated = yes

[RemovedSection]
key = val`
	result := MergeFile("config.ini", template, live)
	if result.Skipped {
		t.Fatalf("expected merge, got skipped: %s", result.Warning)
	}
	if !strings.Contains(result.MergedContent, "maxPlayers = 32") && !strings.Contains(result.MergedContent, "maxPlayers =32") {
		t.Errorf("maxPlayers should be carried as 32, got:\n%s", result.MergedContent)
	}
	if !strings.Contains(result.MergedContent, "newSetting") {
		t.Error("newSetting should be present from template")
	}
	if strings.Contains(result.MergedContent, "oldSetting") {
		t.Error("oldSetting should be dropped")
	}
	if strings.Contains(result.MergedContent, "RemovedSection") {
		t.Error("RemovedSection should be dropped")
	}
	if strings.Contains(result.MergedContent, "deprecated") {
		t.Error("deprecated key should be dropped")
	}
	if result.Stats.Dropped < 3 {
		t.Errorf("expected at least 3 dropped (oldSetting, deprecated, key), got %d", result.Stats.Dropped)
	}
}

func TestMergeINI_CarryValues(t *testing.T) {
	template := "[Settings]\ntimeout = 10\n"
	live := "[Settings]\ntimeout = 60\n"
	result := MergeFile("test.cfg", template, live)
	if result.Stats.Carried != 1 {
		t.Errorf("expected 1 carried, got %d", result.Stats.Carried)
	}
	if !strings.Contains(result.MergedContent, "60") {
		t.Error("expected carried value 60")
	}
}

func TestMergeText_FallsBackToTemplate(t *testing.T) {
	result := MergeFile("readme.txt", "new content", "old content")
	if !result.Skipped {
		t.Error("expected .txt to be skipped (no auto-merge)")
	}
	if result.MergedContent != "new content" {
		t.Error("expected template content for .txt")
	}
}
