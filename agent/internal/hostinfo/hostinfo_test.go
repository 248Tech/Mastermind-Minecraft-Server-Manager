package hostinfo

import (
	"runtime"
	"testing"
)

func TestGatherContainsHostMetricsWithoutGameProbe(t *testing.T) {
	meta, err := Gather()
	if err != nil {
		t.Fatal(err)
	}
	if meta.CPU == "" {
		t.Fatal("architecture must be populated")
	}
	if meta.DiskPath == "" {
		t.Fatal("disk path must be populated")
	}
	if runtime.GOOS != "windows" && meta.DiskPath != "/" {
		t.Fatalf("unexpected disk path %q", meta.DiskPath)
	}
	if meta.GameReachable || meta.LatencyMS != 0 {
		t.Fatal("generic host metrics must not probe a hard-coded game endpoint")
	}
}
