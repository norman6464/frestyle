package ratelimit

import (
	"testing"
	"time"
)

func Test_レートリミッタ_バースト後に拒否(t *testing.T) {
	l := New(60, 3)
	for i := 0; i < 3; i++ {
		if !l.Allow("1.2.3.4") {
			t.Fatalf("request %d should be allowed within burst", i+1)
		}
	}
	if l.Allow("1.2.3.4") {
		t.Fatal("4th request should be denied after burst is exhausted")
	}
}

func Test_レートリミッタ_キーごとに独立(t *testing.T) {
	l := New(60, 1)
	if !l.Allow("a") || !l.Allow("b") {
		t.Fatal("different keys should have independent buckets")
	}
	if l.Allow("a") {
		t.Fatal("same key should be limited after its own burst")
	}
}

func Test_レートリミッタ_時間経過で回復(t *testing.T) {
	cur := time.Now()
	l := New(60, 1) // 1 token/sec
	l.now = func() time.Time { return cur }

	if !l.Allow("k") {
		t.Fatal("first request should pass")
	}
	if l.Allow("k") {
		t.Fatal("immediate second request should be denied")
	}
	cur = cur.Add(1100 * time.Millisecond)
	if !l.Allow("k") {
		t.Fatal("request after refill window should pass")
	}
}

func Test_レートリミッタ_バケツ数に上限がある(t *testing.T) {
	// 鍵を無尽蔵に変えられる経路（例: 詐称した IP・毎回変わるトークン）でも、
	// 表そのものの大きさに歯止めが掛かることを固定する。maxBuckets はテストから直接
	// 小さく差し替える（New の外へ公開のノブは無い — 実運用は defaultMaxBuckets で十分）。
	l := New(60, 1)
	l.maxBuckets = 2

	if !l.Allow("a") || !l.Allow("b") {
		t.Fatal("上限内の異なる鍵は独立して通るはず")
	}
	if l.Allow("c") {
		t.Fatal("表が上限に達したら、新しい鍵は拒否するはず")
	}
	if got := len(l.buckets); got > 2 {
		t.Fatalf("表の大きさが上限を超えて増えてはいけない: %d", got)
	}
	// 既存の鍵（a・b）は表が満杯でも、自分のバケツを普通に消費できる
	// （新しい鍵の作成だけを拒むのであって、既存の利用者を巻き添えにしない）。
	if l.Allow("a") {
		t.Fatal("aはburst=1を使い切っているので2回目は拒否のはず")
	}
}

func Test_レートリミッタ_放置されたバケツは掃除される(t *testing.T) {
	cur := time.Now()
	l := New(60, 1)
	l.now = func() time.Time { return cur }
	l.lastCleanup = cur

	l.Allow("old")
	cur = cur.Add(11 * time.Minute)
	l.Allow("new")

	if _, ok := l.buckets["old"]; ok {
		t.Fatal("idleTTL を超えたバケツは掃除されるはず")
	}
}
