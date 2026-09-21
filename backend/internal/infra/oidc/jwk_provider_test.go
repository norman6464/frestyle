package oidc

import (
	"testing"
	"time"
)

func TestCacheTTLFromHeader_MaxAgeを使う(t *testing.T) {
	fallback := 30 * time.Minute

	got := cacheTTLFromHeader("public, max-age=3600", fallback)

	want := time.Hour
	if got != want {
		t.Fatalf("cacheTTL = %v, want %v", got, want)
	}
}

func TestCacheTTLFromHeader_MaxAgeがない場合はFallbackを使う(t *testing.T) {
	fallback := 30 * time.Minute

	got := cacheTTLFromHeader("public", fallback)

	if got != fallback {
		t.Fatalf("cacheTTL = %v, want %v", got, fallback)
	}
}

func TestCacheTTLFromHeader_MaxAgeが不正な場合はFallbackを使う(t *testing.T) {
	fallback := 30 * time.Minute

	got := cacheTTLFromHeader("public, max-age=invalid", fallback)

	if got != fallback {
		t.Fatalf("cacheTTL = %v, want %v", got, fallback)
	}
}

func TestCacheTTLFromHeader_MaxAgeが0の場合は0を使う(t *testing.T) {
	fallback := 30 * time.Minute

	got := cacheTTLFromHeader("public, max-age=0", fallback)

	if got != 0 {
		t.Fatalf("cacheTTL = %v, want 0", got)
	}
}
