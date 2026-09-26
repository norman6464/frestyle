package domain

import (
	"time"
	"unicode"
	"unicode/utf8"
)

// Page はナレッジの 1 ページ。ページ同士は ParentID で木構造をなす（上限 PageMaxDepth）。
//
// 兄弟の並び順は整数の連番ではなく分数インデックス（internal/pkg/fracindex が採番する文字列キー）
// で持つ。1 行動かすたびに後続を振り直す UPDATE を避けるため。DB 側は position 列を
// COLLATE "C" に固定し、Go のバイト比較と ORDER BY を一致させる。
type Page struct {
	ID string `json:"id"`
	// WorkspaceID はテナント境界。space / 親ページとの複合 FK に使い、テナント越えの親子を
	// DB が弾く。
	WorkspaceID string `json:"workspaceId"`
	SpaceID     string `json:"spaceId"`
	// ParentID は親ページ。NULL はスペース直下（ルート）を意味する。
	ParentID        *string `json:"parentId,omitempty"`
	Position        string  `json:"position"`
	Title           string  `json:"title"`
	CreatedByUserID uint64  `json:"createdByUserId"`
	// ArchivedAt はアーカイブ日時。NULL が現役。物理削除ではなくアーカイブで隠すため、
	// 一意制約（同じ親の中で position が重複しない）はアーカイブ済みを除外した部分ユニークで張る。
	ArchivedAt *time.Time `json:"archivedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	Icon       *PageIcon  `json:"icon,omitempty"`
	// Cover はページ頭部のカバー画像。設定 API は 1b で追加するため、いまは常に nil。
	Cover *PageCover `json:"cover,omitempty"`
	// LastEditedByUserID は最終編集者。NULL は「作成後まだ誰も本文を保存していない」。
	// 本文の保存経路（ReplacePageBlocksUseCase）だけが書く。
	LastEditedByUserID *uint64        `json:"lastEditedByUserId,omitempty"`
	Visibility         PageVisibility `json:"visibility"`
}

// PageIconType はページアイコンの種類。いまのところ絵文字だけを許す
// （アップロード画像・外部 URL は要件に無く、whitelist を広げるのは要る時でよい）。
type PageIconType string

// PageIconTypeEmoji は唯一許可される種類。
const PageIconTypeEmoji PageIconType = "emoji"

// PageIcon はページの顔。保存形は pages.icon の jsonb（例: {"type":"emoji","value":"📘"}）。
type PageIcon struct {
	Type  PageIconType `json:"type"`
	Value string       `json:"value"`
}

// pageIconValueMaxBytes / pageIconValueMaxRunes は Value に許す上限。絵文字 1 つは UTF-8 で
// 最大 4 byte、ZWJ で繋いだ複合絵文字（家族・肌色修飾）でも数個の code point に収まるため、
// この桁で「見た目 1 つ」を大きく外れる値は弾ける。
const (
	pageIconValueMaxBytes = 64
	pageIconValueMaxRunes = 16
)

// Valid は保存してよい形かを返す。見るのは種類の whitelist・空でないこと・正しい UTF-8・
// 長さの上限・空白と制御文字を含まないことまで。**「厳密に 1 grapheme か」は見ない** — 判定には
// unicode/text segmentation の依存が要り、見た目の一意性はピッカー側（厳選した絵文字の格子 +
// countGraphemes による自由入力の絞り込み）が担う。
func (i PageIcon) Valid() bool {
	if i.Type != PageIconTypeEmoji {
		return false
	}
	if i.Value == "" || len(i.Value) > pageIconValueMaxBytes {
		return false
	}
	if !utf8.ValidString(i.Value) {
		return false
	}
	if utf8.RuneCountInString(i.Value) > pageIconValueMaxRunes {
		return false
	}
	for _, r := range i.Value {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// PageCoverType はページカバーの種類。いまのところアップロード画像（オブジェクトストレージの
// key）のみ。
type PageCoverType string

// PageCoverTypeFile はアップロード画像を指す種類（保存形はオブジェクトストレージの key）。
const PageCoverTypeFile PageCoverType = "file"

// PageCover はページ頭部のカバー画像。保存形は pages.cover の jsonb。設定・解除の API は
// 段 1b で追加する。ここでは列との往復（読み出し）だけを担う。
type PageCover struct {
	Type PageCoverType `json:"type"`
	Key  string        `json:"key"`
}
