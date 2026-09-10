package hostinfo

import (
	"runtime"
	"time"

	"github.com/mastermind/agent/internal/client"
)

// staticMetadata is captured once. Architecture and the monitored filesystem
// do not change during an agent process lifetime, while utilization does.
var staticMetadata = client.HostMetadata{CPU: runtime.GOARCH, DiskPath: defaultDiskPath()}

func Gather() (*client.HostMetadata, error) {
	meta := staticMetadata
	meta.ReportedAt = time.Now().UTC()
	meta.CPUPercent = cpuPercent()
	meta.RamTotalMB, meta.MemFreeMB = memoryMB()
	meta.MemTotalMB = uint64(meta.RamTotalMB)
	meta.RamUsedMB = meta.RamTotalMB - float64(meta.MemFreeMB)
	meta.DiskUsedGB, meta.DiskFreeMB = diskUsage()
	return &meta, nil
}
