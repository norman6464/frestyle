// Package ratelimit は「鍵ごとに、単位時間あたり何回まで」を数えるトークンバケットを提供する。
// 鍵に何を使うかはこのパッケージの関心事ではない（呼び出し側が決める）——HTTP 入口で IP を
// 鍵にするのも、ログイン中のユーザーを鍵にするのも同じ実装を使う。gin を import しないのも
// そのためで、middleware 側が *gin.Context から鍵を作って渡す。
//
// 単一インスタンス前提の in-memory 実装。スケールアウトするとインスタンスごとに別カウントに
// なるため、その際は共有ストア（Redis 等）が要る。
package ratelimit

import (
	"sync"
	"time"
)

// bucket は 1 つの鍵ぶんのトークンバケット状態。
type bucket struct {
	tokens float64
	last   time.Time
}

// defaultMaxBuckets は 1 つの Limiter が同時に保持するバケツ数の上限。鍵は呼び出し側が決める
// （IP・ユーザー ID・リンクのトークンなど）ので、攻撃者が鍵を無尽蔵に変えられる経路
// （例: 未認証の要求で毎回ランダムな鍵を送る）では、上限が無いと 1 要求ごとにバケツが増え続け、
// 掃除が回るまで（idleTTL 分）にヒープを埋め尽くせてしまう。実運用でこの数の異なる鍵が
// 同時に生きることはまず無い。
const defaultMaxBuckets = 100_000

// Limiter は鍵ごとのトークンバケットで流量を制限する。ゼロ値は使えない（New を使う）。
type Limiter struct {
	mu          sync.Mutex
	buckets     map[string]*bucket
	rate        float64 // 毎秒の補充トークン数
	burst       float64 // バケット上限
	idleTTL     time.Duration
	maxBuckets  int
	lastCleanup time.Time
	now         func() time.Time // テスト差し替え用
}

// New は「鍵あたり perMinute 回（短期は burst まで許容）」の Limiter を作る。
func New(perMinute float64, burst int) *Limiter {
	return &Limiter{
		buckets:     map[string]*bucket{},
		rate:        perMinute / 60.0,
		burst:       float64(burst),
		idleTTL:     10 * time.Minute,
		maxBuckets:  defaultMaxBuckets,
		lastCleanup: time.Now(),
		now:         time.Now,
	}
}

// Allow は key のトークンを 1 つ消費できれば true を返す。
// 消費できなければ false（＝ 上限に達している）。
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.cleanupLocked(now)

	b, ok := l.buckets[key]
	if !ok {
		if len(l.buckets) >= l.maxBuckets {
			// 定期掃除（idleTTL ごと）を待たずこの場で即座に掃除を試みる。それでも空かなければ
			// 新しい鍵は拒否する（上限に張り付いている＝異常な鍵の量産が起きている状況なので、
			// 素通しで表を無制限に増やすより上限として機能させることを優先する）。
			l.forceCleanupLocked(now)
			if len(l.buckets) >= l.maxBuckets {
				return false
			}
		}
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Seconds() * l.rate
	if b.tokens > l.burst {
		b.tokens = l.burst
	}
	b.last = now

	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// cleanupLocked は idleTTL を超えて使われていないバケツを、周期（idleTTL ごと）でのみ掃除する
// （メモリ肥大化防止）。
func (l *Limiter) cleanupLocked(now time.Time) {
	if now.Sub(l.lastCleanup) < l.idleTTL {
		return
	}
	l.forceCleanupLocked(now)
}

// forceCleanupLocked は周期を待たず、その場で idle なバケツを掃除する。
// 表がバケツ数の上限に張り付いたとき、次の周期を待たずに空きを作るための経路
// （Allow から呼ぶ。単体では呼ばない — lastCleanup の更新も込みで cleanupLocked と共有する）。
func (l *Limiter) forceCleanupLocked(now time.Time) {
	for k, b := range l.buckets {
		if now.Sub(b.last) > l.idleTTL {
			delete(l.buckets, k)
		}
	}
	l.lastCleanup = now
}
