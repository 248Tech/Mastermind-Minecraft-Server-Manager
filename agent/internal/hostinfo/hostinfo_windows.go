//go:build windows

package hostinfo

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

func defaultDiskPath() string {
	wd, err := os.Getwd()
	if err != nil || wd == "" {
		return `C:\`
	}
	vol := filepath.VolumeName(wd)
	if vol == "" {
		return `C:\`
	}
	return vol + `\`
}

func cpuPercent() float64 {
	// Windows host CPU sampling is optional for bring-up; report 0 until a
	// dedicated sampler is wired. Memory/disk still report usable values.
	return 0
}

func memoryMB() (float64, uint64) {
	type memoryStatusEx struct {
		Length               uint32
		MemoryLoad           uint32
		TotalPhys            uint64
		AvailPhys            uint64
		TotalPageFile        uint64
		AvailPageFile        uint64
		TotalVirtual         uint64
		AvailVirtual         uint64
		AvailExtendedVirtual uint64
	}
	mod := syscall.NewLazyDLL("kernel32.dll")
	proc := mod.NewProc("GlobalMemoryStatusEx")
	var ms memoryStatusEx
	ms.Length = uint32(unsafe.Sizeof(ms))
	r, _, _ := proc.Call(uintptr(unsafe.Pointer(&ms)))
	if r == 0 {
		return 0, 0
	}
	return float64(ms.TotalPhys) / (1024 * 1024), ms.AvailPhys / (1024 * 1024)
}

func diskUsage() (float64, uint64) {
	path := defaultDiskPath()
	pathPtr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0
	}
	mod := syscall.NewLazyDLL("kernel32.dll")
	proc := mod.NewProc("GetDiskFreeSpaceExW")
	var freeBytes, totalBytes, totalFreeBytes uint64
	r, _, _ := proc.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytes)),
		uintptr(unsafe.Pointer(&totalBytes)),
		uintptr(unsafe.Pointer(&totalFreeBytes)),
	)
	if r == 0 || totalBytes == 0 {
		return 0, 0
	}
	used := totalBytes - freeBytes
	return float64(used) / (1024 * 1024 * 1024), freeBytes / (1024 * 1024)
}
