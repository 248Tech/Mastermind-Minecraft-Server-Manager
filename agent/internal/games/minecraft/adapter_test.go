package minecraft

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

func TestParseListOutput(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"There are 2 of a max of 20 players online: Alice, Bob", []string{"Alice", "Bob"}},
		{"There are 0 of a max of 20 players online:", nil},
		{"Players online: Carol", []string{"Carol"}},
	}
	for _, tc := range cases {
		got := parseListOutput(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("%q: got %d players, want %d (%v)", tc.in, len(got), len(tc.want), got)
		}
		for i := range tc.want {
			if got[i]["name"] != tc.want[i] {
				t.Fatalf("%q: player[%d]=%v want %s", tc.in, i, got[i]["name"], tc.want[i])
			}
		}
	}
}

func TestModQuarantineRestoreDelete(t *testing.T) {
	root := t.TempDir()
	mods := filepath.Join(root, "mods")
	if err := os.MkdirAll(mods, 0755); err != nil {
		t.Fatal(err)
	}
	jar := filepath.Join(mods, "CoolMod.jar")
	if err := os.WriteFile(jar, []byte("jar"), 0644); err != nil {
		t.Fatal(err)
	}
	a := NewAdapter()
	cfg := &agent.InstanceConfig{InstallPath: root}
	payload := map[string]interface{}{"name": "CoolMod.jar", "kind": "mods"}

	if _, err := a.QuarantineMod(cfg, payload); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(jar); !os.IsNotExist(err) {
		t.Fatal("expected active jar removed")
	}
	q := filepath.Join(mods, ".quarantine", "CoolMod.jar")
	if _, err := os.Stat(q); err != nil {
		t.Fatal(err)
	}
	listed, err := a.ListQuarantinedMods(cfg, payload)
	if err != nil || len(listed) != 1 {
		t.Fatalf("quarantine list: %v %v", listed, err)
	}
	if _, err := a.RestoreMod(cfg, payload); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(jar); err != nil {
		t.Fatal(err)
	}
	if _, err := a.DeleteMod(cfg, map[string]interface{}{"name": "CoolMod.jar", "source": "active", "kind": "mods"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(jar); !os.IsNotExist(err) {
		t.Fatal("expected deleted")
	}
}

func TestModPendingApproveReject(t *testing.T) {
	root := t.TempDir()
	a := NewAdapter()
	cfg := &agent.InstanceConfig{InstallPath: root}
	src := filepath.Join(root, "upload.jar")
	if err := os.WriteFile(src, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	up, err := a.UploadMod(cfg, map[string]interface{}{
		"source_path": src,
		"filename":    "PendingMod.jar",
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	if up["pending"] != true {
		t.Fatalf("want pending: %v", up)
	}
	pending, err := a.ListPendingMods(cfg)
	if err != nil || len(pending) != 1 {
		t.Fatalf("pending list: %v %v", pending, err)
	}
	if _, err := a.ApprovePendingMod(cfg, map[string]interface{}{"name": "PendingMod.jar"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "mods", "PendingMod.jar")); err != nil {
		t.Fatal(err)
	}

	src2 := filepath.Join(root, "upload2.jar")
	_ = os.WriteFile(src2, []byte("x"), 0644)
	_, _ = a.UploadMod(cfg, map[string]interface{}{"source_path": src2, "filename": "RejectMe.jar"}, true)
	if _, err := a.RejectPendingMod(cfg, map[string]interface{}{"name": "RejectMe.jar"}); err != nil {
		t.Fatal(err)
	}
}

func TestModUploadBase64(t *testing.T) {
	root := t.TempDir()
	a := NewAdapter()
	cfg := &agent.InstanceConfig{InstallPath: root}
	b64 := base64.StdEncoding.EncodeToString([]byte("hello-jar"))
	res, err := a.UploadMod(cfg, map[string]interface{}{
		"base64":   b64,
		"filename": "FromB64.jar",
		"kind":     "plugins",
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	if res["quarantined"] != true {
		t.Fatalf("%v", res)
	}
	path := filepath.Join(root, "plugins", ".quarantine", "FromB64.jar")
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "hello-jar" {
		t.Fatalf("got %q err=%v", data, err)
	}
}

func TestSaveListRestoreRetention(t *testing.T) {
	root := t.TempDir()
	world := filepath.Join(root, "world")
	if err := os.MkdirAll(world, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(world, "level.dat"), []byte("live"), 0644); err != nil {
		t.Fatal(err)
	}
	backups := filepath.Join(root, "mastermind-backups")
	if err := os.MkdirAll(backups, 0755); err != nil {
		t.Fatal(err)
	}
	b1 := filepath.Join(backups, "world-20260101-000001")
	b2 := filepath.Join(backups, "world-20260102-000002")
	_ = os.MkdirAll(b1, 0755)
	_ = os.MkdirAll(b2, 0755)
	_ = os.WriteFile(filepath.Join(b1, "level.dat"), []byte("old"), 0644)
	_ = os.WriteFile(filepath.Join(b2, "level.dat"), []byte("new"), 0644)
	// Ensure distinct mtimes for retention ordering.
	oldTime := time.Now().Add(-2 * time.Hour)
	_ = os.Chtimes(b1, oldTime, oldTime)

	a := NewAdapter()
	cfg := &agent.InstanceConfig{InstallPath: root}
	saves, err := a.ListSaves(cfg, nil)
	if err != nil || len(saves) != 2 {
		t.Fatalf("list: %v %v", saves, err)
	}

	ctx := context.Background()
	res, err := a.RestoreSave(ctx, cfg, map[string]interface{}{
		"save_id":   "world-20260102-000002",
		"confirmed": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res["serverStopped"] != true {
		t.Fatalf("%v", res)
	}
	data, _ := os.ReadFile(filepath.Join(world, "level.dat"))
	if string(data) != "new" {
		t.Fatalf("world data %q", data)
	}

	if err := a.PruneSaveBackups(cfg, nil, 1); err != nil {
		t.Fatal(err)
	}
	saves, _ = a.ListSaves(cfg, nil)
	if len(saves) != 1 {
		t.Fatalf("after retention: %v", saves)
	}
}

func TestListAdmins(t *testing.T) {
	root := t.TempDir()
	ops := `[{"uuid":"u1","name":"Alice","level":4,"bypassesPlayerLimit":false}]`
	if err := os.WriteFile(filepath.Join(root, "ops.json"), []byte(ops), 0644); err != nil {
		t.Fatal(err)
	}
	a := NewAdapter()
	admins, err := a.ListAdmins(&agent.InstanceConfig{InstallPath: root}, nil)
	if err != nil || len(admins) != 1 || admins[0]["name"] != "Alice" {
		t.Fatalf("%v %v", admins, err)
	}
}

func TestGrantItemsFromPayload(t *testing.T) {
	items, err := grantItemsFromPayload(map[string]interface{}{
		"items": []interface{}{
			map[string]interface{}{"name": "minecraft:diamond", "quantity": float64(3)},
		},
	})
	if err != nil || len(items) != 1 || items[0].Name != "minecraft:diamond" || items[0].Quantity != 3 {
		t.Fatalf("%v %v", items, err)
	}
}

func TestGrantPlayerTargetPrefersNameThenUUID(t *testing.T) {
	if got := grantPlayerTarget(map[string]interface{}{"name": "Steve"}); got != "Steve" {
		t.Fatalf("name: %q", got)
	}
	if got := grantPlayerTarget(map[string]interface{}{
		"uuid": "550e8400-e29b-41d4-a716-446655440000",
	}); got != "550e8400-e29b-41d4-a716-446655440000" {
		t.Fatalf("uuid: %q", got)
	}
	if got := grantPlayerTarget(map[string]interface{}{
		"identityKey": "uuid:550e8400e29b41d4a716446655440000",
	}); got != "550e8400e29b41d4a716446655440000" {
		t.Fatalf("identityKey: %q", got)
	}
	if got := grantPlayerTarget(map[string]interface{}{"name": "all", "uuid": "not-a-uuid"}); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestGrantOutputClassification(t *testing.T) {
	if !grantOutputMeansOffline("No player was found") {
		t.Fatal("offline")
	}
	if !grantOutputMeansDelivered("Gave 1 [Dirt] to Steve") {
		t.Fatal("delivered")
	}
	if grantOutputMeansDelivered("") {
		t.Fatal("empty should not deliver")
	}
}

func TestLooksLikeChat(t *testing.T) {
	if !looksLikeChat(`[Server thread/INFO]: <Steve> hello`) {
		t.Fatal("expected chat")
	}
	if !looksLikeChat(`[Server thread/INFO]: Steve joined the game`) {
		t.Fatal("expected join")
	}
	if looksLikeChat(`[Server thread/INFO]: Preparing spawn area: 12%`) {
		t.Fatal("should not match")
	}
}

func TestCapabilitiesIncludeStreamAndInstall(t *testing.T) {
	caps := NewAdapter().Capabilities()
	joined := strings.Join(caps, ",")
	if !strings.Contains(joined, agent.CapStreamChat) || !strings.Contains(joined, agent.CapInstallMod) {
		t.Fatalf("%v", caps)
	}
}

func TestExecuteUnsupportedStillFails(t *testing.T) {
	a := NewAdapter()
	res, err := a.Execute(context.Background(), agent.Job{Type: "NOPE", Payload: map[string]interface{}{}})
	if err != nil || res.Status != "failed" {
		t.Fatalf("%v %v", res, err)
	}
}
