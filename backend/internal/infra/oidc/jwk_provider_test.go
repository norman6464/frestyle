package oidc

import (
	"testing"
	"time"
)

func TestCacheTTLFromCacheControl_MaxAgeを使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public, max-age=3600", fallbackTTL)

	want := time.Hour
	if got != want {
		t.Fatalf("cacheTTL = %v, want %v", got, want)
	}
}

func TestCacheTTLFromCacheControl_MaxAgeがない場合はFallbackを使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public", fallbackTTL)

	if got != fallbackTTL {
		t.Fatalf("cacheTTL = %v, want %v", got, fallbackTTL)
	}
}

func TestCacheTTLFromCacheControl_MaxAgeが不正な場合はFallbackを使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public, max-age=invalid", fallbackTTL)

	if got != fallbackTTL {
		t.Fatalf("cacheTTL = %v, want %v", got, fallbackTTL)
	}
}

func TestCacheTTLFromCacheControl_MaxAgeが0の場合は0を使う(t *testing.T) {
	fallbackTTL := 30 * time.Minute

	got := cacheTTLFromCacheControl("public, max-age=0", fallbackTTL)

	if got != 0 {
		t.Fatalf("cacheTTL = %v, want 0", got)
	}
}
