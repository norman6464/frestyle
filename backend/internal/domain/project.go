package domain

import "time"

// Project はバックログの入れ物（案件・チームの単位）。
//
// ワークスペースだけに属し、ナレッジの入れ物（Space）とは関係を持たない — バックログと
// ナレッジは別の製品で、一方の入れ物を消したらもう一方が道連れになる関係を作らない
// （schema.hcl の projects のコメント参照）。共有とメンバー招待はワークスペース単位。
type Project struct {
	ID string `json:"id"`
	// WorkspaceID はテナント境界。チケット系からの複合 FK の参照先にもなる。
	WorkspaceID string `json:"workspaceId"`
	// Key はチケットの表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）。ワークスペース内で一意。
	Key string `json:"key"`
	// Name は表示名。
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ProjectKeyMaxLen / ProjectNameMaxLen は projects の列幅（varchar(64) / varchar(200)）。
const (
	ProjectKeyMaxLen  = 64
	ProjectNameMaxLen = 200
)

// ValidProjectKey はプロジェクトの key として保存してよい形かを返す。
// 形は spaces.key / workspaces.slug と同じ（どれも URL と表示キーに出る短い識別子で、
// 揺れを持ち込まない）。スペースからプロジェクトへ移すときに key をそのまま引き継げる
// よう、規則も同じにしてある。
func ValidProjectKey(key string) bool {
	return validURLKey(key, ProjectKeyMaxLen)
}
