package domain

import (
	"strings"
	"time"
)

// SprintState はスプリントの進み具合。チケットの状態（利用者が自由に足せる）とは違い、
// この 3 つで固定する —— 期間の進み方は業務によって変わらないため。DB の CHECK 制約と
// 対になっているので、増やすときは schema.hcl の ck_sprints_state と同時に変えること。
type SprintState string

const (
	// SprintStatePlanned はまだ始めていない。作った直後は必ずこれ。
	SprintStatePlanned SprintState = "planned"
	// SprintStateActive は進行中。
	SprintStateActive SprintState = "active"
	// SprintStateCompleted は終わった。終わったスプリントは開始し直せない（やり直すなら作る）。
	SprintStateCompleted SprintState = "completed"
)

// ValidSprintStates は保存を許す状態の一覧（進む順）。
var ValidSprintStates = []SprintState{
	SprintStatePlanned,
	SprintStateActive,
	SprintStateCompleted,
}

// Valid は既知の状態かを返す（保存前の検証に使う）。
func (s SprintState) Valid() bool {
	for _, v := range ValidSprintStates {
		if v == s {
			return true
		}
	}
	return false
}

// CanTransitionTo は状態を移してよいかを返す。
//
// 進む向きにしか動かさない（planned → active → completed）。戻せるようにすると
// 「完了したスプリントの中身を後から書き換える」経路ができ、終わった期間の記録が
// 後から変わる。やり直したいときは新しいスプリントを作る。
func (s SprintState) CanTransitionTo(next SprintState) bool {
	switch s {
	case SprintStatePlanned:
		return next == SprintStateActive
	case SprintStateActive:
		return next == SprintStateCompleted
	default:
		return false
	}
}

// SprintNameMaxLen は sprints.name の列幅（varchar(200)）。
const SprintNameMaxLen = 200

// ValidSprintName は名前として保存してよい形かを返す。空白だけの名前は拒む
// （DB の ck_sprints_name_not_empty と対）。
func ValidSprintName(name string) bool {
	trimmed := strings.TrimSpace(name)
	return trimmed != "" && len([]rune(name)) <= SprintNameMaxLen
}

// ValidSprintPeriod は期間の前後関係が壊れていないかを返す。
// 片方でも未定（nil）なら比較しない —— 計画中は決まっていないことが普通なので。
// DB の ck_sprints_period_order と対。
func ValidSprintPeriod(startDate, endDate *string) bool {
	if startDate == nil || endDate == nil {
		return true
	}
	return *startDate <= *endDate
}

// Sprint はバックログの仕事を「いつやるか」でまとめる区切り。プロジェクトに属する。
type Sprint struct {
	ID          string      `json:"id"`
	WorkspaceID string      `json:"workspaceId"`
	ProjectID   string      `json:"projectId"`
	Name        string      `json:"name"`
	State       SprintState `json:"state"`
	// StartDate / EndDate は 'YYYY-MM-DD' の文字列（tickets の日付と同じ運び方）。
	// 計画中は未定でよいので、どちらも NULL を取りうる。
	StartDate *string `json:"startDate,omitempty"`
	EndDate   *string `json:"endDate,omitempty"`
	// Position はプロジェクト内の並び順（fracindex）。
	Position  string    `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
