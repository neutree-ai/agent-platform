package cache

import (
	"crypto/rand"
	"encoding/hex"
)

// randSuffix is used to disambiguate concurrent rename targets (atomic write
// tmp files, invalidate-stash directories). Doesn't need cryptographic
// guarantees; we just want collision resistance across goroutines.
func randSuffix() string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
