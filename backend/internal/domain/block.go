package domain

import "time"

// BlockType は blocks.type に入るノード名。値は ProseMirror（tiptap）のノード名そのもの。
//
// frontend の本文エディタが組み立てるスキーマと 1 対 1 に対応する。両者は
// contracts/kb-block-types.json を正本として、それぞれのテストで突き合わせる
// （スキーマにないノード名を保存すると、読み出したドキュメントがエディタで開けなくなる）。
type BlockType string

// ブロック行として保存するノード名の一覧。doc は「ページそのもの」なのでブロック行にはしない。
// text / hardBreak などのインラインノードは行にせず、親ブロックの inline（jsonb）に ProseMirror
// の content 配列として持たせる（文字単位で行を作ると 1 段落の編集が大量の行更新になるため、
// 行の粒度はブロックで止める）。
const (
	BlockTypeParagraph      BlockType = "paragraph"
	BlockTypeHeading        BlockType = "heading"
	BlockTypeCodeBlock      BlockType = "codeBlock"
	BlockTypeBlockquote     BlockType = "blockquote"
	BlockTypeBulletList     BlockType = "bulletList"
	BlockTypeOrderedList    BlockType = "orderedList"
	BlockTypeListItem       BlockType = "listItem"
	BlockTypeTaskList       BlockType = "taskList"
	BlockTypeTaskItem       BlockType = "taskItem"
	BlockTypeTable          BlockType = "table"
	BlockTypeTableRow       BlockType = "tableRow"
	BlockTypeTableHeader    BlockType = "tableHeader"
	BlockTypeTableCell      BlockType = "tableCell"
	BlockTypeImage          BlockType = "image"
	BlockTypeHorizontalRule BlockType = "horizontalRule"
)

// blockTypeSpec は種類 1 つの定義。Container は「子がブロック行になる容器」かどうか。
// 葉（Container=false）は content（text ノードとマークの配列）を行にせず inline に丸ごと持つ。
// 粒度の境界はスキーマ設計（Block.Inline のコメント）で決めたもの: 文字単位で行を作ると
// 1 段落の編集が大量の行更新になるため、行はブロックで止める。
type blockTypeSpec struct {
	Type      BlockType
	Container bool
}

// blockTypeSpecs は保存を許す種類と、容器かどうかの 1 表（登録順は表示順とは無関係）。
//
// 種類を足すときは、ここと contracts/kb-block-types.json の両方を直す（突き合わせの
// テストが block_contract_test.go にある）。容器かどうかは、この表の外では判定しない。
// 容器を葉として登録してしまうと、保存は通るのに中のブロックが丸ごと 1 行の inline に
// 入り、中の段落へのコメント・検索・被リンクが黙って壊れる。
var blockTypeSpecs = []blockTypeSpec{
	{BlockTypeParagraph, false},
	{BlockTypeHeading, false},
	{BlockTypeCodeBlock, false},
	{BlockTypeBlockquote, true},
	{BlockTypeBulletList, true},
	{BlockTypeOrderedList, true},
	{BlockTypeListItem, true},
	{BlockTypeTaskList, true},
	{BlockTypeTaskItem, true},
	{BlockTypeTable, true},
	{BlockTypeTableRow, true},
	{BlockTypeTableHeader, true},
	{BlockTypeTableCell, true},
	{BlockTypeImage, false},
	{BlockTypeHorizontalRule, false},
}

// ValidBlockTypes は保存を許すノード名の一覧。blockTypeSpecs から導く。
var ValidBlockTypes = func() []BlockType {
	types := make([]BlockType, 0, len(blockTypeSpecs))
	for _, s := range blockTypeSpecs {
		types = append(types, s.Type)
	}
	return types
}()

// blockTypeContainer は種類 → 容器かどうか。blockTypeSpecs から導く（Valid と IsContainer が引く）。
var blockTypeContainer = func() map[BlockType]bool {
	m := make(map[BlockType]bool, len(blockTypeSpecs))
	for _, s := range blockTypeSpecs {
		m[s.Type] = s.Container
	}
	return m
}()

// Valid は既知のノード名かを返す（保存前の検証に使う）。
func (t BlockType) Valid() bool {
	_, ok := blockTypeContainer[t]
	return ok
}

// IsContainer は子がブロック行になる容器かを返す。未知の種類は容器ではない（Valid で先に弾く）。
func (t BlockType) IsContainer() bool {
	return blockTypeContainer[t]
}

// Block はページ本文を構成する 1 ブロック（段落・見出し・リスト項目・表のセル …）。
//
// ページ全体を 1 つの jsonb にまとめる持ち方と違い、ブロックを行に分解して持つ。
// 部分更新・ブロック単位のリンク / コメント・全文検索の単位を DB 側で扱えるようにするため。
// 入れ子（リストや表）は ParentID の自己参照で表し、兄弟の並びは Position（分数インデックス）で持つ。
type Block struct {
	ID string `json:"id"`
	// WorkspaceID はテナント境界。page / 親ブロックとの複合 FK に使う。
	WorkspaceID string `json:"workspaceId"`
	// PageID は所属ページ。(workspace_id, page_id) の複合 FK で pages を参照する。
	PageID string `json:"pageId"`
	// ParentID は親ブロック。NULL はページ直下（トップレベル）を意味する。
	ParentID *string   `json:"parentId,omitempty"`
	Position string    `json:"position"`
	Type     BlockType `json:"type"`
	// Attrs は ProseMirror の attrs（見出しの level、コードブロックの language など）を jsonb で
	// 持つ。属性が無いノードでも空オブジェクト {} を入れる（NULL と {} の二通りを作らない）。
	// API へは handler の response 型で json.RawMessage に変換して出す。
	Attrs string `json:"-"`
	// Inline は葉ノードのインライン内容（text ノードとマークの配列）。リストや表のような容器
	// ノードは子をブロック行として持つため NULL にする。
	Inline    *string   `json:"-"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
