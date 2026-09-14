package domain

import (
	"errors"
	"strings"
	"time"
)

// ProjectVersion はプロジェクトのリリース版（チケットの「修正バージョン」の選択肢）。
//
// プロジェクト単位にしてあるのは、版が製品ごとの概念だから —— 同じワークスペースでも
// 別製品の「1.2.0」は別物で、取り違えると直したつもりのない版に印が付く。
type ProjectVersion struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	ProjectID   string `json:"projectId"`
	Name        string `json:"name"`
	// ReleasedAt が NULL なら「まだ出していない」。出した日そのものに意味があるので
	// boolean には畳まない。
	ReleasedAt *time.Time `json:"releasedAt,omitempty"`
	Position   string     `json:"position"`
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

// ProjectVersionNameMax は版名の上限（schema.hcl の character_varying(60) と揃える）。
const ProjectVersionNameMax = 60

// ErrInvalidProjectVersionName は空・空白だけ・長すぎる版名に対して返す。
var ErrInvalidProjectVersionName = errors.New("invalid project version name")

// ValidProjectVersionName は保存してよい版名かを返す。前後の空白は呼び出し側が落とす前提。
func ValidProjectVersionName(name string) bool {
	trimmed := strings.TrimSpace(name)
	return trimmed != "" && len([]rune(trimmed)) <= ProjectVersionNameMax
}
