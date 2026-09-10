//go:build !windows

package hostinfo

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

var cpuState struct {
	sync.Mutex
	total uint64
	idle  uint64
}

func defaultDiskPath() string { return "/" }

func cpuPercent() float64 {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	fields := strings.Fields(strings.SplitN(string(b), "\n", 2)[0])
	if len(fields) < 5 {
		return 0
	}
	var values []uint64
	for _, field := range fields[1:] {
		v, _ := strconv.ParseUint(field, 10, 64)
		values = append(values, v)
	}
	var total uint64
	for _, v := range values {
		total += v
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	cpuState.Lock()
	defer cpuState.Unlock()
	deltaTotal, deltaIdle := total-cpuState.total, idle-cpuState.idle
	cpuState.total, cpuState.idle = total, idle
	if deltaTotal == 0 || cpuState.total == deltaTotal {
		return 0
	}
	return 100 * float64(deltaTotal-deltaIdle) / float64(deltaTotal)
}

func memoryMB() (float64, uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	var total, available uint64
	s := bufio.NewScanner(f)
	for s.Scan() {
		parts := strings.Fields(s.Text())
		if len(parts) < 2 {
			continue
		}
		v, _ := strconv.ParseUint(parts[1], 10, 64)
		switch strings.TrimSuffix(parts[0], ":") {
		case "MemTotal":
			total = v
		case "MemAvailable":
			available = v
		}
	}
	return float64(total) / 1024, available / 1024
}

func diskUsage() (float64, uint64) {
	var stat syscall.Statfs_t
	if syscall.Statfs("/", &stat) != nil {
		return 0, 0
	}
	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	return float64(total-free) / (1024 * 1024 * 1024), free / (1024 * 1024)
}
