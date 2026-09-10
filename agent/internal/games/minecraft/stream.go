package minecraft

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

var chatishLineRe = regexp.MustCompile(`(?i)(joined the game|left the game|has made the advancement|was slain by|fell from a high place)`)

// StreamChat tails logs/latest.log and writes chat-ish lines until ctx is done.
func (a *Adapter) StreamChat(ctx context.Context, cfg *agent.InstanceConfig, w io.Writer) error {
	logPath, err := a.GetLogPath(cfg)
	if err != nil || logPath == "" {
		return agent.ErrUnsupported
	}
	return followLogChat(ctx, logPath, w)
}

func followLogChat(ctx context.Context, path string, w io.Writer) error {
	var offset int64
	if info, err := os.Stat(path); err == nil {
		offset = info.Size()
	}
	var carry []byte

	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := readNewLogChunk(path, &offset, &carry, w)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if n == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(500 * time.Millisecond):
			}
		}
	}
}

func readNewLogChunk(path string, offset *int64, carry *[]byte, w io.Writer) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	size := info.Size()
	if size < *offset {
		*offset = 0
		*carry = nil
	}
	if size == *offset {
		return 0, nil
	}
	if _, err := f.Seek(*offset, io.SeekStart); err != nil {
		return 0, err
	}
	chunk, err := io.ReadAll(io.LimitReader(f, size-*offset))
	if err != nil {
		return 0, err
	}
	*offset = size

	data := append(append([]byte{}, *carry...), chunk...)
	*carry = nil
	written := 0

	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		return 0, err
	}
	if len(data) > 0 && data[len(data)-1] != '\n' && len(lines) > 0 {
		*carry = []byte(lines[len(lines)-1])
		lines = lines[:len(lines)-1]
	}
	for _, line := range lines {
		if looksLikeChat(line) {
			if _, err := fmt.Fprintln(w, line); err != nil {
				return written, err
			}
			written++
		}
	}
	return written, nil
}

func looksLikeChat(line string) bool {
	if strings.Contains(line, "<") && strings.Contains(line, ">") {
		return true
	}
	return chatishLineRe.MatchString(line)
}
