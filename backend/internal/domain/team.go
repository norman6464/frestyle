package domain

import (
	"errors"
	"strings"
	"time"
)

// Team はプロジェクトのチーム。チケットの担当チーム（tickets.team_id）の選択肢になる。
//
// 担当（1 人）とは別の概念。担当は責任の所在、チームは「どの塊の仕事か」を表す。
type Team struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	ProjectID   string    `json:"projectId"`
	Name        string    `json:"name"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	// Members は所属する人。一覧では詰めない（要るときだけ引く）。
	Members []TeamMember `json:"members,omitempty"`
}

// TeamMember はチームに属する人 1 件。
type TeamMember struct {
	UserID uint64 `json:"userId"`
	Name   string `json:"name"`
}

// TeamNameMax はチーム名の上限（schema.hcl の character_varying(60) と揃える）。
const TeamNameMax = 60

// ErrInvalidTeamName は空・空白だけ・長すぎるチーム名に対して返す。
var ErrInvalidTeamName = errors.New("invalid team name")

// ValidTeamName は保存してよいチーム名かを返す。
func ValidTeamName(name string) bool {
	trimmed := strings.TrimSpace(name)
	return trimmed != "" && len([]rune(trimmed)) <= TeamNameMax
}
