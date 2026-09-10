package minecraft

import (
	"bufio"
	"fmt"
	"net"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

// gamePorts returns RCON and game listen ports to use for process lookup.
func gamePorts(cfg *agent.InstanceConfig) []int {
	ports := make([]int, 0, 2)
	if cfg.RconPort > 0 {
		ports = append(ports, cfg.RconPort)
	}
	if cfg.Extra != nil {
		switch v := cfg.Extra["server_port"].(type) {
		case float64:
			if int(v) > 0 {
				ports = append(ports, int(v))
			}
		case int:
			if v > 0 {
				ports = append(ports, v)
			}
		case string:
			if p, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && p > 0 {
				ports = append(ports, p)
			}
		}
	}
	if len(ports) == 0 {
		ports = append(ports, 25565, 25575)
	}
	return uniqueInts(ports)
}

func uniqueInts(in []int) []int {
	seen := map[int]struct{}{}
	out := make([]int, 0, len(in))
	for _, p := range in {
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func portListening(host string, port int) bool {
	if host == "" {
		host = "127.0.0.1"
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 400*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// findPIDsListeningOn returns PIDs that have a TCP LISTEN on any of the ports.
func findPIDsListeningOn(ports []int) ([]int, error) {
	if len(ports) == 0 {
		return nil, nil
	}
	want := map[int]struct{}{}
	for _, p := range ports {
		want[p] = struct{}{}
	}
	cmd := exec.Command("netstat", "-ano")
	if runtime.GOOS != "windows" {
		cmd = exec.Command("netstat", "-tlnp")
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	pids := map[int]struct{}{}
	sc := bufio.NewScanner(strings.NewReader(string(out)))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || !strings.Contains(strings.ToUpper(line), "LISTEN") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		local := fields[1]
		if runtime.GOOS != "windows" && len(fields) > 3 {
			// Linux: Proto Recv-Q Send-Q Local Address Foreign Address State PID/Program
			local = fields[3]
		}
		port := parseLocalPort(local)
		if _, ok := want[port]; !ok {
			continue
		}
		pid := 0
		if runtime.GOOS == "windows" {
			pid, _ = strconv.Atoi(fields[len(fields)-1])
		} else {
			// last field like "1234/java"
			last := fields[len(fields)-1]
			pidStr := strings.Split(last, "/")[0]
			pid, _ = strconv.Atoi(pidStr)
		}
		if pid > 0 {
			pids[pid] = struct{}{}
		}
	}
	outPIDs := make([]int, 0, len(pids))
	for pid := range pids {
		outPIDs = append(outPIDs, pid)
	}
	return outPIDs, nil
}

func parseLocalPort(addr string) int {
	addr = strings.TrimSpace(addr)
	// [::]:25565 or 0.0.0.0:25565 or 127.0.0.1:25565
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		p, _ := strconv.Atoi(addr[i+1:])
		return p
	}
	return 0
}

func killPID(pid int) error {
	if pid <= 0 {
		return fmt.Errorf("invalid pid")
	}
	if runtime.GOOS == "windows" {
		out, err := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").CombinedOutput()
		if err != nil {
			return fmt.Errorf("taskkill %d: %w (%s)", pid, err, strings.TrimSpace(string(out)))
		}
		return nil
	}
	out, err := exec.Command("kill", "-9", strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		return fmt.Errorf("kill %d: %w (%s)", pid, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func waitPortsClosed(host string, ports []int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		anyUp := false
		for _, p := range ports {
			if portListening(host, p) {
				anyUp = true
				break
			}
		}
		if !anyUp {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

// forceStopProcesses kills listeners on game/RCON ports after a graceful stop attempt.
func forceStopProcesses(cfg *agent.InstanceConfig) error {
	ports := gamePorts(cfg)
	pids, err := findPIDsListeningOn(ports)
	if err != nil {
		return err
	}
	if len(pids) == 0 {
		// Nothing listening — treat as already stopped.
		return nil
	}
	var errs []string
	for _, pid := range pids {
		if err := killPID(pid); err != nil {
			errs = append(errs, err.Error())
		}
	}
	host := cfg.RconHost
	if host == "" {
		host = "127.0.0.1"
	}
	_ = waitPortsClosed(host, ports, 8*time.Second)
	if len(errs) > 0 {
		return fmt.Errorf("process kill: %s", strings.Join(errs, "; "))
	}
	return nil
}
