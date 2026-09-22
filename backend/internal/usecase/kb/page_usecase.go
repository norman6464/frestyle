package kb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ナレッジのページ操作で共通のビジネスルール違反。
// handler はこれらを errors.Is で判定して HTTP ステータスにマップする（400/409 相当）。
var (
	// ErrPageArchived はアーカイブ済みページへの変更操作（改名・移動・本文書き換え）に返す。
	ErrPageArchived = errors.New("page is archived")
	// ErrPageParentArchived はアーカイブ済みページを親に指定した操作に返す。
	// アーカイブ済みの親に現役の子ができるとツリーに現れない「迷子ページ」になるため入口で塞ぐ。
	ErrPageParentArchived = errors.New("parent page is archived")
	// ErrPageParentSpaceMismatch は指定スペースと親ページの所属スペースが食い違うときに返す。
	// ページの木はスペースの中で閉じる（DB の複合 FK と同じ規則を入口でも検証する）。
	ErrPageParentSpaceMismatch = errors.New("parent page belongs to a different space")
	// ErrPageAnchorNotSibling は、移動で指定された「隣のページ」が移動先の現役の子で
	// なかったときに返す。不在・別の親・別スペース・アーカイブ済みを区別しない。
	//
	// 黙って末尾へ落とさないのは、**利用者が落とした場所と違う場所に入り、しかも
	// 成功したように見える**ため。断って、やり直せるようにする。
	ErrPageAnchorNotSibling = errors.New("anchor page is not a sibling under the destination")
	// ErrPageCycle は自分自身または自分の子孫の下への移動に返す（木が壊れる）。
	ErrPageCycle = domain.ErrPageCycle
	// ErrInvalidPageIcon は domain.PageIcon.Valid() を満たさない値を設定しようとしたときに返す。
	ErrInvalidPageIcon = errors.New("invalid page icon")
	// ErrPageEditorRequired は本文書き換えの入力に編集者（EditorUserID）が無いときに返す。
	// 最終編集者を記録できないまま保存を許すと、誰が書いたか分からないページができる。
	ErrPageEditorRequired = errors.New("editor user id is required")
	// ErrInvalidImageKey はダウンロード URL 発行で key が空のときに返す。
	ErrInvalidImageKey = errors.New("invalid image key")
	// ErrInvalidCoverKey は、カバーに設定しようとした key がそのページ自身へアップロードした
	// ものではない（"kb/<workspaceId>/<pageId>/" 接頭辞と完全一致しない）ときに返す。
	//
	// カバーはダウンロードと違い「他ページからの貼り付け」という正当な利用シーンが無いため、
	// ダウンロード URL 発行にある「同一ワークスペース内ならフォールバックで許す」を持たない
	// （SetPageCoverUseCase の doc 参照）。
	ErrInvalidCoverKey = errors.New("invalid cover key")
)

// kbPageTitleMaxLen は pages.title (varchar(200)) の上限。DB エラーの前に入口で弾く。
const kbPageTitleMaxLen = 200

// CreatePageUseCase はスペース直下または親ページの下に新しいページを作る。
// 兄弟の末尾へ分数インデックスで採番し、closure（page_paths）もページと同時に張られる。
type CreatePageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewCreatePageUseCase(r repository.KnowledgeBaseRepository) *CreatePageUseCase {
	return &CreatePageUseCase{repo: r}
}

type CreatePageInput struct {
	WorkspaceID string
	SpaceID     string
	// ParentID が nil ならスペース直下（ルート）に作る。
	ParentID        *string
	Title           string
	CreatedByUserID uint64
}

func (u *CreatePageUseCase) Execute(ctx context.Context, in CreatePageInput) (*domain.Page, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	if in.CreatedByUserID == 0 {
		return nil, errors.New("createdByUserID is required")
	}
	if utf8.RuneCountInString(in.Title) > kbPageTitleMaxLen {
		return nil, errors.New("title is too long")
	}
	// 親があるときは**スペースを引かない**。引くと FindSpace の 404/400 の出方の違いから
	// 「URL の spaceID が実在するか」が漏れる（他 3 経路は塞いでいる existence oracle）。
	// 親が在ること自体がスペースの実在の証明なので、あとは「親のスペースと URL のスペースが
	// 一致するか」の文字列比較だけで済む（不在も別実在も同じ 400 に畳む）。親が無いときは
	// 比較相手が無いので、これまでどおり引いて確かめる。
	if in.ParentID == nil {
		if _, err := u.repo.FindSpace(ctx, in.WorkspaceID, in.SpaceID); err != nil {
			return nil, err
		}
	} else {
		parent, err := u.repo.FindPage(ctx, in.WorkspaceID, *in.ParentID)
		if err != nil {
			return nil, err
		}
		if parent.SpaceID != in.SpaceID {
			return nil, ErrPageParentSpaceMismatch
		}
		if parent.ArchivedAt != nil {
			return nil, ErrPageParentArchived
		}
	}
	last, err := u.repo.LastActiveSiblingPosition(ctx, in.WorkspaceID, in.SpaceID, in.ParentID)
	if err != nil {
		return nil, err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return nil, err
	}
	page := &domain.Page{
		WorkspaceID:     in.WorkspaceID,
		SpaceID:         in.SpaceID,
		ParentID:        in.ParentID,
		Position:        pos,
		Title:           in.Title,
		CreatedByUserID: in.CreatedByUserID,
	}
	if err := u.repo.CreatePage(ctx, page); err != nil {
		return nil, err
	}
	return page, nil
}

// GetPageUseCase はページ 1 件とその本文（ProseMirror doc）を返す。
// 本文は snapshot（本文書き換えと同一トランザクションで焼き直される読み取りキャッシュ）を
// 優先し、無ければ（未保存の新規ページ）blocks から組み立てる。
type GetPageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewGetPageUseCase(r repository.KnowledgeBaseRepository) *GetPageUseCase {
	return &GetPageUseCase{repo: r}
}

type GetPageInput struct {
	WorkspaceID string
	PageID      string
}

// GetPageOutput はページのメタ情報と本文の組。
type GetPageOutput struct {
	Page domain.Page `json:"page"`
	// Doc は ProseMirror ドキュメント（JSON 文字列）。API へは handler の response 型で
	// json.RawMessage に変換して出す。
	Doc string `json:"-"`
	// BuiltAt は snapshot の焼き直し時刻（= 直近の本文保存と同じトランザクションの時刻）。
	// snapshot がまだ無く blocks から都度組み立てた場合は nil
	// （pages.updated_at は改名・アイコン変更でも動くので、最終編集の時刻にはこちらを使う）。
	BuiltAt *time.Time `json:"-"`
}

func (u *GetPageUseCase) Execute(ctx context.Context, in GetPageInput) (*GetPageOutput, error) {
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	snap, err := u.repo.GetPageSnapshot(ctx, in.WorkspaceID, in.PageID)
	if err == nil {
		builtAt := snap.BuiltAt
		return &GetPageOutput{Page: *page, Doc: snap.Doc, BuiltAt: &builtAt}, nil
	}
	if !errors.Is(err, repository.ErrPageSnapshotNotFound) {
		return nil, err
	}
	blocks, err := u.repo.ListBlocksByPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	tree, err := treeFromBlocks(blocks)
	if err != nil {
		return nil, err
	}
	doc, err := renderPageDoc(tree)
	if err != nil {
		return nil, err
	}
	return &GetPageOutput{Page: *page, Doc: doc}, nil
}

// GetPageTreeUseCase はスペース配下の現役ページを木構造（表示順）で返す。
type GetPageTreeUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewGetPageTreeUseCase(r repository.KnowledgeBaseRepository) *GetPageTreeUseCase {
	return &GetPageTreeUseCase{repo: r}
}

type GetPageTreeInput struct {
	WorkspaceID string
	SpaceID     string
}

func (u *GetPageTreeUseCase) Execute(ctx context.Context, in GetPageTreeInput) ([]*PageTreeNode, error) {
	if _, err := u.repo.FindSpace(ctx, in.WorkspaceID, in.SpaceID); err != nil {
		return nil, err
	}
	pages, err := u.repo.ListActivePagesBySpace(ctx, in.WorkspaceID, in.SpaceID)
	if err != nil {
		return nil, err
	}
	// 一覧はスペースの現役ページ全件で、権限でふるいにかけていない。ここで親が欠けるのは
	// アーカイブ運用の不変条件（サブツリーごと archive）が崩れた行だけなので、
	// データを隠さないようルート扱いで見せる（表示が乱れても本文は失わない）。
	return BuildPageTree(pages, PageTreeOrphanAsRoot), nil
}

// RenamePageUseCase はページのタイトルを変更する。
type RenamePageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewRenamePageUseCase(r repository.KnowledgeBaseRepository) *RenamePageUseCase {
	return &RenamePageUseCase{repo: r}
}

type RenamePageInput struct {
	WorkspaceID string
	PageID      string
	Title       string
}

func (u *RenamePageUseCase) Execute(ctx context.Context, in RenamePageInput) (*domain.Page, error) {
	if utf8.RuneCountInString(in.Title) > kbPageTitleMaxLen {
		return nil, errors.New("title is too long")
	}
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	return u.repo.UpdatePageTitle(ctx, in.WorkspaceID, in.PageID, in.Title)
}

// FindPageUseCase はページ 1 件のメタ情報だけを引く（本文は読まない）。
// 権限操作 API（ページ付与・共有リンク）の認可がこれを使う — 編集の可否は「そのページが
// 属するスペースの admin か」で決まるため、まずスペースを知る必要がある。認可より前に
// 呼ばれる口なので、本文まで読めてしまうと認可前に中身が見えてしまう。
type FindPageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewFindPageUseCase(r repository.KnowledgeBaseRepository) *FindPageUseCase {
	return &FindPageUseCase{repo: r}
}

type FindPageInput struct {
	WorkspaceID string
	PageID      string
}

func (u *FindPageUseCase) Execute(ctx context.Context, in FindPageInput) (*domain.Page, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return nil, repository.ErrPageNotFound
	}
	return u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
}

// ResolvePageLocationUseCase は URL の /p/{pageId}（テナントを出さない）からページの
// 居場所（ワークスペース）を特定する。テナント確定前に呼ばれる唯一のページ読みなので
// 権限判定はしない。呼び出し側は返った WorkspaceID で必ず CheckPagePermissionUseCase を通すこと。
type ResolvePageLocationUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewResolvePageLocationUseCase(r repository.KnowledgeBaseRepository) *ResolvePageLocationUseCase {
	return &ResolvePageLocationUseCase{repo: r}
}

type ResolvePageLocationOutput struct {
	Page      domain.Page
	Workspace domain.Workspace
}

func (u *ResolvePageLocationUseCase) Execute(ctx context.Context, pageID string) (*ResolvePageLocationOutput, error) {
	if pageID == "" {
		return nil, repository.ErrPageNotFound
	}
	page, err := u.repo.FindPageByIDAcrossWorkspaces(ctx, pageID)
	if err != nil {
		return nil, err
	}
	ws, err := u.repo.FindWorkspaceByID(ctx, page.WorkspaceID)
	if err != nil {
		return nil, err
	}
	// この id 経路は ResolveWorkspaceUseCase（slug 経路）を通らないため、停止判定をここでも行う。
	if !ws.IsActive {
		return nil, repository.ErrPageNotFound
	}
	return &ResolvePageLocationOutput{Page: *page, Workspace: *ws}, nil
}

// DeletePageUseCase はページを子孫ごと物理削除する。
// アーカイブ（隠すだけ・戻せる）とは別の操作で、こちらは戻せない。
// 誰が消せるか（根と子孫全部の編集権限）は handler の入口が確かめる。
type DeletePageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewDeletePageUseCase(r repository.KnowledgeBaseRepository) *DeletePageUseCase {
	return &DeletePageUseCase{repo: r}
}

type DeletePageInput struct {
	WorkspaceID string
	PageID      string
}

func (u *DeletePageUseCase) Execute(ctx context.Context, in DeletePageInput) error {
	return u.repo.DeletePageSubtree(ctx, in.WorkspaceID, in.PageID)
}

// ErrPageDocInvalid は ProseMirror ドキュメントとして解釈できない入力に返す（400 相当）。
var ErrPageDocInvalid = errors.New("invalid prosemirror doc")

// ErrPageDocUnknownNodeType は domain.BlockType に無いブロックノードを含む入力に返す（400 相当）。
// スキーマに無いノード名を保存すると読み出したドキュメントがエディタで開けなくなるため、入口で弾く。
var ErrPageDocUnknownNodeType = errors.New("unknown block node type")

// ProseMirror ドキュメントを解釈するときの入れ子と規模の上限。
// 解釈は各段で部分木の JSON を複製するため、無制限だと本文の大きさの上限（1MiB 強）に
// 収まる 1 要求で記憶域を「入力 × 段数」まで膨らませられる（数本並べるだけで落とせる）。
// 30 段はエディタで作れる入れ子より十分深く、ノード数上限は 1 万行規模の保険。
const (
	kbDocMaxDepth = 30
	kbDocMaxNodes = 10000
)

// kbCodeBlockLanguages はコードブロックの language 属性に受け付ける値（frontend の
// codeBlockLanguages.ts と同じ一覧）。language は読み手の画面で class 属性にそのまま
// 埋め込まれるため、ここに無い値（任意の class を足せてしまう）は保存時に落とす。
var kbCodeBlockLanguages = map[string]bool{
	"plaintext": true, "sql": true, "typescript": true, "javascript": true, "go": true,
	"python": true, "bash": true, "json": true, "yaml": true, "xml": true,
	"css": true, "markdown": true, "diff": true, "java": true, "kotlin": true,
	"swift": true, "php": true, "ruby": true, "rust": true, "c": true,
	"cpp": true, "csharp": true, "graphql": true, "ini": true, "makefile": true,
	"scss": true, "shell": true, "lua": true, "perl": true, "r": true,
}

// kbContainerBlockTypes は子がブロック行になる「容器ノード」。それ以外の既知ノードは
// 「葉ノード」で、content（text ノードとマークの配列）を行にせず inline に丸ごと持つ。
// 粒度の境界はスキーマ設計（blocks.inline のコメント）で決めたもの: 文字単位で行を作ると
// 1 段落の編集が大量の行更新になるため、行はブロックで止める。
var kbContainerBlockTypes = map[domain.BlockType]bool{
	domain.BlockTypeBlockquote:  true,
	domain.BlockTypeBulletList:  true,
	domain.BlockTypeOrderedList: true,
	domain.BlockTypeListItem:    true,
	domain.BlockTypeTaskList:    true,
	domain.BlockTypeTaskItem:    true,
	domain.BlockTypeTable:       true,
	domain.BlockTypeTableRow:    true,
	domain.BlockTypeTableHeader: true,
	domain.BlockTypeTableCell:   true,
}

// kbDocNode はブロック行 1 つに対応する中間表現。分解（doc → 行）と組み立て（行 → doc）が
// この木を共有することで、保存する snapshot が必ず「行から再生成できる形」になる。
type kbDocNode struct {
	// ID は blocks.id に対応する。parsePageDoc が返す木のすべてのノードは、呼び出し完了
	// 時点で必ず有効な非空 UUID 文字列を持つ（parseBlockNode がクライアント由来の
	// attrs.id を検証するか、無ければ新規採番する）。差分 UPSERT で行を同一に保つための鍵。
	ID       string
	Type     domain.BlockType
	Attrs    string  // JSON object。属性が無ければ "{}"（NULL と {} の二通りを作らない）
	Inline   *string // JSON array。葉ノードの content。容器ノード・content 無しは nil
	Children []*kbDocNode
}

// kbRawNode は ProseMirror ノードの JSON を最小限に読むための型。
// text / marks 等ここに無いフィールドは、葉ノードでは content の中に丸ごと残り、
// ブロックノード自身に付いていた場合は正規化で落ちる（行スキーマに置き場が無いため）。
type kbRawNode struct {
	Type    string          `json:"type"`
	Attrs   json.RawMessage `json:"attrs"`
	Content json.RawMessage `json:"content"`
}

// parsePageDoc は ProseMirror ドキュメント（type='doc'）をブロック木に分解する。
// ルート doc ノードは行にせず、doc.content の各ノードがトップレベルブロックになる。
func parsePageDoc(doc string) ([]*kbDocNode, error) {
	var root kbRawNode
	if err := json.Unmarshal([]byte(doc), &root); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
	}
	if root.Type != "doc" {
		return nil, fmt.Errorf("%w: ルートは type='doc' が必要（got %q）", ErrPageDocInvalid, root.Type)
	}
	return parseBlockNodes(root.Content, 1, &kbDocBudget{remaining: kbDocMaxNodes})
}

// kbDocBudget は 1 回の解釈で読み進めてよいノードの残数。木のどの枝を降りていても
// 同じ 1 つを共有するので、幅で稼ぐ入力も深さで稼ぐ入力も同じ 1 本の物差しで止まる。
type kbDocBudget struct{ remaining int }

func (b *kbDocBudget) take() error {
	if b.remaining <= 0 {
		return fmt.Errorf("%w: ノードが多すぎます（上限 %d 個）", ErrPageDocInvalid, kbDocMaxNodes)
	}
	b.remaining--
	return nil
}

// parseBlockNodes は content 配列（JSON）をブロックノード列として解釈する。空・省略は 0 件。
// depth は今いる段（doc 直下が 1）。
func parseBlockNodes(content json.RawMessage, depth int, budget *kbDocBudget) ([]*kbDocNode, error) {
	if len(content) == 0 || string(content) == "null" {
		return []*kbDocNode{}, nil
	}
	if depth > kbDocMaxDepth {
		return nil, fmt.Errorf("%w: 入れ子が深すぎます（上限 %d 段）", ErrPageDocInvalid, kbDocMaxDepth)
	}
	var items []json.RawMessage
	if err := json.Unmarshal(content, &items); err != nil {
		return nil, fmt.Errorf("%w: content が配列ではありません: %w", ErrPageDocInvalid, err)
	}
	nodes := make([]*kbDocNode, 0, len(items))
	for _, item := range items {
		n, err := parseBlockNode(item, depth, budget)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, nil
}

func parseBlockNode(raw json.RawMessage, depth int, budget *kbDocBudget) (*kbDocNode, error) {
	if err := budget.take(); err != nil {
		return nil, err
	}
	var rn kbRawNode
	if err := json.Unmarshal(raw, &rn); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
	}
	t := domain.BlockType(rn.Type)
	if !t.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrPageDocUnknownNodeType, rn.Type)
	}

	node := &kbDocNode{Type: t, Attrs: "{}"}
	m := map[string]json.RawMessage{}
	if len(rn.Attrs) > 0 && string(rn.Attrs) != "null" {
		// attrs は object であること（DDL の CHECK と同じ壁を入口にも置く）。
		if err := json.Unmarshal(rn.Attrs, &m); err != nil {
			return nil, fmt.Errorf("%w: attrs が object ではありません: %w", ErrPageDocInvalid, err)
		}
	}
	// attrs.id はクライアント由来のブロック id。有効な UUID ならそのまま使う（同じ id で
	// 保存を繰り返す限り blocks.id が変わらないことが、差分 UPSERT で comment_threads.block_id
	// の紐付けを保つ唯一の理由）。無い・文字列でない・UUID として parse できない場合は
	// ここで新規採番する。attrs が最初から空でもこのロジックは同じように通す。
	node.ID = uuid.NewString()
	if raw, ok := m["id"]; ok {
		var idStr string
		if err := json.Unmarshal(raw, &idStr); err == nil {
			if _, err := uuid.Parse(idStr); err == nil {
				node.ID = idStr
			}
		}
	}
	// "id" キーは map から削除してから残りを node.Attrs へ再マーシャルする。保存される
	// attrs JSONB には id を絶対に含めない — id は blocks.id という別の列で管理する
	// 唯一の情報源にする（attrs と PK の二重管理を避けるための設計判断）。
	delete(m, "id")
	if err := normalizeBlockAttrs(t, m); err != nil {
		return nil, err
	}
	if len(m) > 0 {
		attrs, err := json.Marshal(m)
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
		}
		node.Attrs = string(attrs)
	}

	if kbContainerBlockTypes[t] {
		children, err := parseBlockNodes(rn.Content, depth+1, budget)
		if err != nil {
			return nil, err
		}
		node.Children = children
		return node, nil
	}
	// 葉ノード: content はインライン内容として丸ごと inline に持つ。
	if len(rn.Content) > 0 && string(rn.Content) != "null" {
		// 配列であることの検証を兼ねて要素単位で読み直し、空白差を吸収した形で持ち直す
		// （jsonb は保存時に正規化されるため、入力の空白を残しても意味が無い）。
		var items []json.RawMessage
		if err := json.Unmarshal(rn.Content, &items); err != nil {
			return nil, fmt.Errorf("%w: content が配列ではありません: %w", ErrPageDocInvalid, err)
		}
		if err := validateInlineNodes(items, depth+1, budget); err != nil {
			return nil, err
		}
		if len(items) > 0 {
			compact, err := json.Marshal(items)
			if err != nil {
				return nil, fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
			}
			s := string(compact)
			node.Inline = &s
		}
	}
	return node, nil
}

// kbInlineImageKeyPrefix は本文に置ける画像 src の唯一の形。実体は
// kbImageKeyPrefix が採番する "kb/<workspaceId>/<pageId>/…" で、ここでは
// ワークスペースもページも分からないので接頭辞だけを見る（テナントの照合は
// ダウンロード URL の発行時に key を突き合わせて行う）。
const kbInlineImageKeyPrefix = "kb/"

// normalizeBlockAttrs は種別ごとに attrs を検査する（m は id を除いた属性）。画像の src は
// 落とさず断る（黙って消すと本人に気づかれないまま画像が消える）。コードブロックの
// language は見た目の手がかりでしかないので、知らない値は外して既定に落とすだけにする。
func normalizeBlockAttrs(t domain.BlockType, m map[string]json.RawMessage) error {
	switch t {
	case domain.BlockTypeImage:
		var src string
		raw, ok := m["src"]
		if ok {
			if err := json.Unmarshal(raw, &src); err != nil {
				return fmt.Errorf("%w: 画像の src が文字列ではありません", ErrPageDocInvalid)
			}
		}
		// 外部の URL を通すと、そのページを開いた全員のブラウザが、書いた人の選んだ
		// 相手へ黙って要求を出す（読んだ人の IP・時刻がそこへ渡る）。本文に置けるのは
		// 自分たちの保管庫の key だけにする。
		if !strings.HasPrefix(src, kbInlineImageKeyPrefix) {
			return fmt.Errorf("%w: 画像の src は %q で始まる保管庫の key だけを受け付けます", ErrPageDocInvalid, kbInlineImageKeyPrefix)
		}
	case domain.BlockTypeCodeBlock:
		raw, ok := m["language"]
		if !ok {
			return nil
		}
		var lang string
		if err := json.Unmarshal(raw, &lang); err != nil || !kbCodeBlockLanguages[lang] {
			delete(m, "language")
		}
	}
	return nil
}

// validateInlineNodes は葉ノードの content（インライン列）を検査する。見るのは「要素が
// {"type": 文字列, …} の object か」だけ。null や数値を混ぜたまま保存できると、描画側が
// .type を読んだ瞬間に落ちる（保存者ではなく、そのページを開いた全員が落ちる）。marks も
// 同じ理由で見る。入れ子の content には段数とノード数の上限を引き継ぐ。
func validateInlineNodes(items []json.RawMessage, depth int, budget *kbDocBudget) error {
	if len(items) == 0 {
		return nil
	}
	if depth > kbDocMaxDepth {
		return fmt.Errorf("%w: 入れ子が深すぎます（上限 %d 段）", ErrPageDocInvalid, kbDocMaxDepth)
	}
	for _, item := range items {
		if err := budget.take(); err != nil {
			return err
		}
		var n struct {
			Type    string            `json:"type"`
			Marks   []json.RawMessage `json:"marks"`
			Content []json.RawMessage `json:"content"`
		}
		if err := json.Unmarshal(item, &n); err != nil {
			return fmt.Errorf("%w: content の要素が object ではありません: %w", ErrPageDocInvalid, err)
		}
		if n.Type == "" {
			return fmt.Errorf("%w: content の要素に type がありません", ErrPageDocInvalid)
		}
		for _, mark := range n.Marks {
			if err := budget.take(); err != nil {
				return err
			}
			var mk struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(mark, &mk); err != nil {
				return fmt.Errorf("%w: marks の要素が object ではありません: %w", ErrPageDocInvalid, err)
			}
			if mk.Type == "" {
				return fmt.Errorf("%w: marks の要素に type がありません", ErrPageDocInvalid)
			}
		}
		if len(n.Content) > 0 {
			if err := validateInlineNodes(n.Content, depth+1, budget); err != nil {
				return err
			}
		}
	}
	return nil
}

// flattenPageDoc はブロック木を保存用の行（文書順・親が先）へ平坦化する。
// 兄弟の position は fracindex の末尾追加で採番する（i 件目 = Between(直前, "")）。
//
// コピー&ペーストやブロック複製は ProseMirror の attrs（id 込み）をそのまま複製するため、
// 同じ id を持つノードが doc に混ざりうる。parseBlockNode は node 単体しか見ず一意性を
// 検証しないため、ここで重複した id（2 件目以降）を新しい UUID に採番し直す。しないと
// ReplacePageBlocks の UPSERT が同じ id へ複数回書き込み、最後の内容だけが残って前の内容が
// 無言で消える。
func flattenPageDoc(nodes []*kbDocNode) ([]repository.BlockWrite, error) {
	out := make([]repository.BlockWrite, 0)
	seen := make(map[string]struct{})
	var walk func(nodes []*kbDocNode, parentID *string) error
	walk = func(nodes []*kbDocNode, parentID *string) error {
		prev := ""
		for _, n := range nodes {
			pos, err := fracindex.Between(prev, "")
			if err != nil {
				return err
			}
			prev = pos
			for {
				if _, dup := seen[n.ID]; !dup {
					break
				}
				n.ID = uuid.NewString()
			}
			seen[n.ID] = struct{}{}
			out = append(out, repository.BlockWrite{
				ID:       n.ID,
				ParentID: parentID,
				Position: pos,
				Type:     n.Type,
				Attrs:    n.Attrs,
				Inline:   n.Inline,
			})
			childParent := n.ID // ループ変数 n のアドレスをそのまま取らないための退避
			if err := walk(n.Children, &childParent); err != nil {
				return err
			}
		}
		return nil
	}
	if err := walk(nodes, nil); err != nil {
		return nil, err
	}
	return out, nil
}

// treeFromBlocks は DB のブロック行をブロック木へ組み直す。兄弟は position のバイト順
// （= COLLATE "C" の ORDER BY と同じ）に並べる。親が見つからない行は closure や FK が
// 壊れているサインなのでエラーにする（黙って本文を欠落させない）。
func treeFromBlocks(blocks []domain.Block) ([]*kbDocNode, error) {
	nodes := make(map[string]*kbDocNode, len(blocks))
	order := make(map[string]string, len(blocks)) // id → position（兄弟ソート用）
	for _, b := range blocks {
		if !b.Type.Valid() {
			return nil, fmt.Errorf("%w: %q", ErrPageDocUnknownNodeType, b.Type)
		}
		n := &kbDocNode{ID: b.ID, Type: b.Type, Attrs: b.Attrs}
		if b.Attrs == "" {
			n.Attrs = "{}"
		}
		if b.Inline != nil {
			s := *b.Inline
			n.Inline = &s
		}
		nodes[b.ID] = n
		order[b.ID] = b.Position
	}
	roots := make([]*kbDocNode, 0)
	rootIDs := make([]string, 0)
	childIDs := make(map[string][]string, len(blocks))
	for _, b := range blocks {
		if b.ParentID == nil {
			rootIDs = append(rootIDs, b.ID)
			continue
		}
		if _, ok := nodes[*b.ParentID]; !ok {
			return nil, fmt.Errorf("ブロック %s の親 %s がページ内にありません", b.ID, *b.ParentID)
		}
		childIDs[*b.ParentID] = append(childIDs[*b.ParentID], b.ID)
	}
	sortByPosition := func(ids []string) {
		sort.SliceStable(ids, func(i, j int) bool { return order[ids[i]] < order[ids[j]] })
	}
	sortByPosition(rootIDs)
	for _, ids := range childIDs {
		sortByPosition(ids)
	}
	for pid, ids := range childIDs {
		for _, id := range ids {
			nodes[pid].Children = append(nodes[pid].Children, nodes[id])
		}
	}
	for _, id := range rootIDs {
		roots = append(roots, nodes[id])
	}
	return roots, nil
}

// renderPageDoc はブロック木から ProseMirror ドキュメント（正規形）を組み立てる。
// 正規形: content は空でも必ず配列で出す／attrs は id を含めて必ず出す（renderBlockNode
// 参照）／content が無ければ出さない。parsePageDoc → renderPageDoc の往復は id を除けば
// 同値になる（id 無し入力は呼び出しごとに新規採番されるため。requireJSONEqIgnoringBlockIDs 参照）。
func renderPageDoc(nodes []*kbDocNode) (string, error) {
	content, err := renderBlockNodes(nodes)
	if err != nil {
		return "", err
	}
	doc, err := json.Marshal(struct {
		Type    string            `json:"type"`
		Content []json.RawMessage `json:"content"`
	}{Type: "doc", Content: content})
	if err != nil {
		return "", err
	}
	return string(doc), nil
}

func renderBlockNodes(nodes []*kbDocNode) ([]json.RawMessage, error) {
	out := make([]json.RawMessage, 0, len(nodes))
	for _, n := range nodes {
		raw, err := renderBlockNode(n)
		if err != nil {
			return nil, err
		}
		out = append(out, raw)
	}
	return out, nil
}

func renderBlockNode(n *kbDocNode) (json.RawMessage, error) {
	node := struct {
		Type    string          `json:"type"`
		Attrs   json.RawMessage `json:"attrs,omitempty"`
		Content json.RawMessage `json:"content,omitempty"`
	}{Type: string(n.Type)}

	// id は保存時に attrs から抜かれ blocks.id という別列で管理されるため、書き戻すのは
	// レンダリング側の責務（この結果、すべてのブロックノードは常に attrs を持つ）。
	m := map[string]json.RawMessage{}
	if n.Attrs != "" && n.Attrs != "{}" {
		if err := json.Unmarshal([]byte(n.Attrs), &m); err != nil {
			return nil, fmt.Errorf("ブロックの attrs が壊れています: %w", err)
		}
	}
	idJSON, err := json.Marshal(n.ID)
	if err != nil {
		return nil, fmt.Errorf("ブロックの id を JSON 化できません: %w", err)
	}
	m["id"] = idJSON
	attrs, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("ブロックの attrs を組み立てられません: %w", err)
	}
	node.Attrs = attrs

	switch {
	case len(n.Children) > 0:
		children, err := renderBlockNodes(n.Children)
		if err != nil {
			return nil, err
		}
		arr, err := json.Marshal(children)
		if err != nil {
			return nil, err
		}
		node.Content = arr
	case n.Inline != nil:
		node.Content = json.RawMessage(*n.Inline)
	}
	return json.Marshal(node)
}

// PageTreeNode はページツリーの 1 ノード。
type PageTreeNode struct {
	Page     domain.Page     `json:"page"`
	Children []*PageTreeNode `json:"children"`
}

// PageTreeOrphanPolicy は「親が一覧に含まれていないページ」の扱いを決める。
type PageTreeOrphanPolicy int

const (
	// PageTreeOrphanAsRoot は親が一覧に無いページを根として見せる。
	// 一覧がスペースの現役ページ全件（ふるいにかけていない）で、親が欠けているのは
	// アーカイブ運用の不変条件が崩れた行に限られる場面で使う。データを隠さないことを優先する。
	PageTreeOrphanAsRoot PageTreeOrphanPolicy = iota
	// PageTreeOrphanHidden は親が一覧に無いページを、その子孫ごとツリーから落とす。
	// 権限でふるいにかけた一覧から木を組むときはこちらを使う。
	PageTreeOrphanHidden
)

// BuildPageTree は position 順に並んだページの平坦な一覧を木に組み立てる
// （同じ親を持つページ同士の入力の並びは兄弟順としてそのまま保たれる）。
//
// 権限でふるいにかけた一覧の場合、親が落ちたページを根に昇格させてはならない
// （PageTreeOrphanHidden）。昇格させると「見えないはずの親の下に何かがある」ことが
// ツリーの形から読み取れ、隠した親のタイトルは伏せたまま配下の存在だけが漏れる。
// 見えない親の配下は直リンクで開いたときに個別の権限で判断される。
func BuildPageTree(pages []domain.Page, policy PageTreeOrphanPolicy) []*PageTreeNode {
	nodes := make(map[string]*PageTreeNode, len(pages))
	for _, p := range pages {
		nodes[p.ID] = &PageTreeNode{Page: p, Children: make([]*PageTreeNode, 0)}
	}
	roots := make([]*PageTreeNode, 0)
	for _, p := range pages {
		node := nodes[p.ID]
		if p.ParentID == nil {
			roots = append(roots, node)
			continue
		}
		if parent, ok := nodes[*p.ParentID]; ok {
			parent.Children = append(parent.Children, node)
			continue
		}
		if policy == PageTreeOrphanAsRoot {
			roots = append(roots, node)
		}
		// PageTreeOrphanHidden: どこにも繋がない。根から辿れないので子孫ごと結果に出ない。
	}
	return roots
}

// ReplacePageBlocksUseCase はページ本文（ProseMirror doc）をブロック行に分解して
// 全入れ替えし、snapshot を焼き直す（差分更新は将来の最適化。まず全消し全入れで正しさを取る）。
// 保存する snapshot は入力 doc そのものではなく分解した木から組み立て直した正規形にする —
// 「snapshot は必ず blocks から再生成できる」という不変条件を、未知フィールド等を含む入力
// でも崩さないため。本文の保存に続けて versionRepo.CreateVersionIfDue を同じトランザクションで
// 呼ぶ（版と履歴）。通常の自動保存は 10 分規則で間引かれ、Input.ForceVersion が true のとき
// （「版を残す」・復元）だけ必ず 1 件切る。
type ReplacePageBlocksUseCase struct {
	repo        repository.KnowledgeBaseRepository
	txManager   repository.TxManager
	versionRepo repository.PageVersionRepository
}

func NewReplacePageBlocksUseCase(
	r repository.KnowledgeBaseRepository, txManager repository.TxManager, versionRepo repository.PageVersionRepository,
) *ReplacePageBlocksUseCase {
	return &ReplacePageBlocksUseCase{repo: r, txManager: txManager, versionRepo: versionRepo}
}

type ReplacePageBlocksInput struct {
	WorkspaceID string
	PageID      string
	// Doc は ProseMirror ドキュメント（tiptap の getJSON() 相当の JSON 文字列）。
	Doc string
	// EditorUserID は本文を保存した人（users.id）。0（未指定）は拒否する — 記録できない
	// まま保存を許すと、誰が最後に書いたか分からないページができてしまう。
	EditorUserID uint64
	// ForceVersion は versionRepo.CreateVersionIfDue の 10 分規則を無視して必ず版を切らせる。
	// 通常の自動保存はゼロ値 false のまま — 「版を残す」相当の明示操作と復元だけが true を渡す。
	ForceVersion bool
	// VersionNote は切る版に添えるメモ（任意）。通常の自動保存はゼロ値 nil のまま。
	// domain.ValidateVersionNote による検証は versionRepo 側（CreateExplicitPageVersionUseCase /
	// RestorePageVersionUseCase）が済ませた前提で、ここでは検証しない。
	VersionNote *string
}

func (u *ReplacePageBlocksUseCase) Execute(ctx context.Context, in ReplacePageBlocksInput) (*domain.PageSnapshot, error) {
	if in.EditorUserID == 0 {
		return nil, ErrPageEditorRequired
	}
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	// ページ参照の title は読み手ごとの派生値なので保存しない（StripPageRefTitles の
	// コメント参照 — 保存すると、解決済みの題名が編集者の保存で本文へ焼き込まれ、
	// 閲覧できない読み手にも返ってしまう）。
	tree, err := parsePageDoc(StripPageRefTitles(in.Doc))
	if err != nil {
		return nil, err
	}
	rows, err := flattenPageDoc(tree)
	if err != nil {
		return nil, err
	}
	normalized, err := renderPageDoc(tree)
	if err != nil {
		return nil, err
	}
	// 本文検索・逆リンクの材料を抽出する。flattenPageDoc の**後**に
	// 呼ぶこと — flattenPageDoc は木の中の重複 id を新規 UUID へ採番し直すため
	// （flattenPageDoc の doc 参照）、先に呼ばないと抽出した SourceBlockID が実際に
	// UPSERT される blocks.id とずれてしまう。
	body := extractPageBodyText(tree)
	linkRefs := extractPageLinks(tree)
	pageLinks := make([]repository.PageLinkWrite, len(linkRefs))
	for i, l := range linkRefs {
		pageLinks[i] = repository.PageLinkWrite{SourceBlockID: l.SourceBlockID, TargetPageID: l.TargetPageID}
	}
	ticketLinkRefs := extractPageTicketLinks(tree)
	pageTicketLinks := make([]repository.PageTicketLinkWrite, len(ticketLinkRefs))
	for i, l := range ticketLinkRefs {
		pageTicketLinks[i] = repository.PageTicketLinkWrite{SourceBlockID: l.SourceBlockID, TargetTicketID: l.TargetTicketID}
	}
	// 最終編集者の記録・本文の全消し全入れ・版の記録は同じトランザクションに入れる。
	// Touch を先に呼ぶのは、UPDATE が pages の対象行を排他ロックするため
	// （同じページへの同時保存がここで直列化される。TouchPageLastEditedBy の doc 参照）。
	// versionRepo.CreateVersionIfDue はこの後さらに pages 行をロックし直すが、同一
	// トランザクション内の再ロックなので待たされない（pageVersionRepository の doc 参照）。
	// CreateVersionIfDue が失敗したら、本文の書き換え（TouchPageLastEditedBy /
	// ReplacePageBlocks）ごとロールバックする — 版だけ作れず本文だけ進む中間状態を作らない。
	if err := u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := u.repo.TouchPageLastEditedBy(ctx, in.WorkspaceID, in.PageID, in.EditorUserID); err != nil {
			return err
		}
		if err := u.repo.ReplacePageBlocks(ctx, in.WorkspaceID, in.PageID, rows, normalized, page.Title, body, pageLinks, pageTicketLinks); err != nil {
			return err
		}
		_, _, err := u.versionRepo.CreateVersionIfDue(
			ctx, in.WorkspaceID, in.PageID, normalized, in.EditorUserID, in.VersionNote, in.ForceVersion,
		)
		return err
	}); err != nil {
		return nil, err
	}
	return u.repo.GetPageSnapshot(ctx, in.WorkspaceID, in.PageID)
}

// SetPageIconUseCase はページのアイコンを設定・解除する（Input.Icon が nil なら解除）。
type SetPageIconUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewSetPageIconUseCase(r repository.KnowledgeBaseRepository) *SetPageIconUseCase {
	return &SetPageIconUseCase{repo: r}
}

type SetPageIconInput struct {
	WorkspaceID string
	PageID      string
	// Icon は設定するアイコン。nil なら解除。
	Icon *domain.PageIcon
}

func (u *SetPageIconUseCase) Execute(ctx context.Context, in SetPageIconInput) (*domain.Page, error) {
	// 形の検証は repository を呼ぶ前に済ませる。不正な値で FindPage まで進めると
	// 「値は捨てられたが読みには行った」という中途半端な副作用が残る。
	if in.Icon != nil && !in.Icon.Valid() {
		return nil, ErrInvalidPageIcon
	}
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	return u.repo.UpdatePageIcon(ctx, in.WorkspaceID, in.PageID, in.Icon)
}

// ErrInvalidPageVisibility は保存を許さない visibility 値を渡したときに返す。
var ErrInvalidPageVisibility = errors.New("invalid page visibility")

// SetPageVisibilityUseCase はページの公開範囲を変更する（値の検証と書き換えのみ）。
// visibility そのものの意味（'private' が唯一の打ち消し例外であること）は
// domain.ResolvePagePermission / domain.ResolvePageView が持つ。
type SetPageVisibilityUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewSetPageVisibilityUseCase(r repository.KnowledgeBaseRepository) *SetPageVisibilityUseCase {
	return &SetPageVisibilityUseCase{repo: r}
}

type SetPageVisibilityInput struct {
	WorkspaceID string
	PageID      string
	Visibility  domain.PageVisibility
}

func (u *SetPageVisibilityUseCase) Execute(ctx context.Context, in SetPageVisibilityInput) (*domain.Page, error) {
	if !domain.ValidPageVisibility(in.Visibility) {
		return nil, ErrInvalidPageVisibility
	}
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	return u.repo.UpdatePageVisibility(ctx, in.WorkspaceID, in.PageID, in.Visibility)
}

// kbImageKeyPrefix はページ 1 枚に閉じた画像 key の接頭辞（"kb/<workspaceId>/<pageId>/"）を返す。
// アップロードで採番する key、カバー・ダウンロードで照合する key の両方がこの形に従う。
func kbImageKeyPrefix(workspaceID, pageID string) string {
	return "kb/" + workspaceID + "/" + pageID + "/"
}

// IssuePageImageUploadURLUseCase はページに閉じた画像（本文・カバー共通）の PUT presigned URL を
// 発行する。key は "kb/<workspaceId>/<pageId>/<epochNs>.bin" の形で採番する
// （rich-text の rich-text/{userId}/{epochNs}.bin と同じ発想でページ ID を混ぜ、
// どのページ由来か後から分かるようにしてある）。
type IssuePageImageUploadURLUseCase struct {
	repo      repository.KnowledgeBaseRepository
	presigner repository.KbImagePresigner
}

func NewIssuePageImageUploadURLUseCase(r repository.KnowledgeBaseRepository, p repository.KbImagePresigner) *IssuePageImageUploadURLUseCase {
	return &IssuePageImageUploadURLUseCase{repo: r, presigner: p}
}

type IssuePageImageUploadURLInput struct {
	WorkspaceID string
	PageID      string
	ContentType string
	Size        int64
}

type IssuePageImageUploadURLOutput struct {
	URL       string
	Key       string
	ExpiresIn int
}

func (u *IssuePageImageUploadURLUseCase) Execute(ctx context.Context, in IssuePageImageUploadURLInput) (*IssuePageImageUploadURLOutput, error) {
	// SetPageIconUseCase と同じく、形の検証は repository を呼ぶ前に済ませる。不正な値で
	// FindPage まで進めると「値は捨てられたが読みには行った」という中途半端な副作用が残る
	// （不正な contentType / size は repository を一切呼ばずに拒否することをテストで固定する）。
	if err := domain.ValidateImageUpload(in.ContentType, in.Size); err != nil {
		return nil, err
	}
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	key := fmt.Sprintf("%s%d.bin", kbImageKeyPrefix(in.WorkspaceID, in.PageID), time.Now().UnixNano())
	url, expiresIn, err := u.presigner.PresignUpload(ctx, key, in.ContentType, in.Size)
	if err != nil {
		return nil, err
	}
	return &IssuePageImageUploadURLOutput{URL: url, Key: key, ExpiresIn: expiresIn}, nil
}

// IssuePageImageDownloadURLUseCase はページに閉じた画像の GET（ダウンロード）presigned URL を発行する。
//
// 認可（このページを閲覧できるか）は handler 側の requirePagePermission が済ませている前提で、
// ここで見るのは「この key がこのページに結びついているか」だけ。
type IssuePageImageDownloadURLUseCase struct {
	repo      repository.KnowledgeBaseRepository
	presigner repository.KbImagePresigner
}

func NewIssuePageImageDownloadURLUseCase(r repository.KnowledgeBaseRepository, p repository.KbImagePresigner) *IssuePageImageDownloadURLUseCase {
	return &IssuePageImageDownloadURLUseCase{repo: r, presigner: p}
}

type IssuePageImageDownloadURLInput struct {
	WorkspaceID string
	PageID      string
	Key         string
}

type IssuePageImageDownloadURLOutput struct {
	URL       string
	ExpiresIn int
}

func (u *IssuePageImageDownloadURLUseCase) Execute(ctx context.Context, in IssuePageImageDownloadURLInput) (*IssuePageImageDownloadURLOutput, error) {
	if in.Key == "" {
		return nil, ErrInvalidImageKey
	}
	// **通すのは自ページ由来の key だけ**（画像はページに閉じた持ち物。カバーと同じ扱い）。
	// 「同じワークスペース内なら、その key が自分の本文に貼られていれば通す」という
	// フォールバックはしない。これは自作自演で破れる: 自分が編集できるページの blocks.attrs
	// （ProseMirror の attrs をそのまま持つ jsonb）に他ページの key を書き込むだけで
	// 「貼られている」を自分で作れてしまい、そのページの閲覧権限を失ったあとも画像へ届き
	// 続けられる（「要求元ページを読めるか」ではなく「画像の持ち主のページを読めるか」を
	// 見なければならない）。
	if !strings.HasPrefix(in.Key, kbImageKeyPrefix(in.WorkspaceID, in.PageID)) {
		return nil, repository.ErrPageNotFound
	}
	return u.presignDownload(ctx, in.Key)
}

func (u *IssuePageImageDownloadURLUseCase) presignDownload(ctx context.Context, key string) (*IssuePageImageDownloadURLOutput, error) {
	url, expiresIn, err := u.presigner.PresignDownload(ctx, key)
	if err != nil {
		return nil, err
	}
	return &IssuePageImageDownloadURLOutput{URL: url, ExpiresIn: expiresIn}, nil
}

// SetPageCoverUseCase はページのカバー画像を設定・解除する（Input.Key が nil なら解除）。
type SetPageCoverUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewSetPageCoverUseCase(r repository.KnowledgeBaseRepository) *SetPageCoverUseCase {
	return &SetPageCoverUseCase{repo: r}
}

type SetPageCoverInput struct {
	WorkspaceID string
	PageID      string
	// Key は設定するカバーのオブジェクトストレージ key。nil なら解除。
	Key *string
}

func (u *SetPageCoverUseCase) Execute(ctx context.Context, in SetPageCoverInput) (*domain.Page, error) {
	var cover *domain.PageCover
	if in.Key != nil {
		// key の形の検証は repository を呼ぶ前に済ませる（SetPageIconUseCase と同じ理由）。
		// カバーはそのページ自身へアップロードした画像だけを許す — ダウンロード側にある
		// フォールバックはここには持たせない。カバーには「他ページからの貼り付け」という
		// 正当な利用シーンが無く、キーの偽装を許す理由も無いため（ErrInvalidCoverKey 参照）。
		if !strings.HasPrefix(*in.Key, kbImageKeyPrefix(in.WorkspaceID, in.PageID)) {
			return nil, ErrInvalidCoverKey
		}
		cover = &domain.PageCover{Type: domain.PageCoverTypeFile, Key: *in.Key}
	}
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	return u.repo.UpdatePageCover(ctx, in.WorkspaceID, in.PageID, cover)
}

// ResolveCoverURLUseCase はページのカバー（オブジェクトストレージ key）をダウンロード presigned URL へ解決する。
// SetCover / ClearCover のレスポンス作成と、ResolveByID（/p/{pageId}）ハンドラの両方から呼ばれる。
type ResolveCoverURLUseCase struct {
	presigner repository.KbImagePresigner
}

func NewResolveCoverURLUseCase(p repository.KbImagePresigner) *ResolveCoverURLUseCase {
	return &ResolveCoverURLUseCase{presigner: p}
}

// ResolvedCover はカバーの表示に要る形（種類 + 解決済みの URL）。
type ResolvedCover struct {
	Type      string
	URL       string
	ExpiresIn int
}

// Execute は cover が nil なら (nil, nil) を返す（「カバーが無い」を表す）。
// presigner の失敗はそのまま呼び出し側へ伝える。失敗時に応答全体を止めるか、
// user.LookupUserDisplayUseCase のように空のまま続けるかは呼び出し側（handler）の
// 判断に委ねる。
func (u *ResolveCoverURLUseCase) Execute(ctx context.Context, cover *domain.PageCover) (*ResolvedCover, error) {
	if cover == nil {
		return nil, nil
	}
	url, expiresIn, err := u.presigner.PresignDownload(ctx, cover.Key)
	if err != nil {
		return nil, err
	}
	return &ResolvedCover{Type: string(cover.Type), URL: url, ExpiresIn: expiresIn}, nil
}

// MovePageUseCase はページ（とその子孫）を別の親・別のスペースへ移す。
// 循環検出 → 移動先末尾の position 採番 → pages / page_paths / 子孫 space_id の
// 一括更新（repository 内の 1 トランザクション）の順で行う。
type MovePageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewMovePageUseCase(r repository.KnowledgeBaseRepository) *MovePageUseCase {
	return &MovePageUseCase{repo: r}
}

type MovePageInput struct {
	WorkspaceID string
	PageID      string
	// NewParentID が nil ならスペース直下（ルート）へ移す。
	NewParentID *string
	// NewSpaceID は NewParentID が nil のときの移動先スペース。空なら現在のスペースの
	// ルートへ移す。NewParentID があるときは親の所属スペースが移動先になる
	// （指定があれば親と一致することを検証する）。
	NewSpaceID string
	// Anchor は移動先の兄弟の中でどこに置くかを、隣のページの ID で表す。
	// 空なら末尾（これまでの挙動）。
	//
	// 並び順のキーを client から受け取らないのは、そもそも渡していないため。
	// キーの整数部は兄弟の通し番号になるので、飛びから伏せた枚数が読める。
	// 「どの兄弟の隣か」だけを受け取り、キーの計算はサーバー側に閉じる。
	Anchor string
	// AnchorBefore が true なら Anchor の**手前**、false なら**直後**に置く。
	// 「先頭に置く」は「最初の兄弟の手前」として表す（専用の値を作らない）。
	AnchorBefore bool
}

// placementPosition は移動先での並び順のキーを決める。Anchor が空なら末尾（これまでの
// 挙動）、あれば隣り合う 2 つの中間値としてキーを計算する。**動く行は 1 つだけ**で、
// 他の兄弟のキーは書き換えない（整数の連番なら以降を全部ずらすことになる）。
func (u *MovePageUseCase) placementPosition(ctx context.Context, in MovePageInput, targetSpaceID string) (string, error) {
	if in.Anchor == "" {
		last, err := u.repo.LastActiveSiblingPosition(ctx, in.WorkspaceID, targetSpaceID, in.NewParentID)
		if err != nil {
			return "", err
		}
		return fracindex.Between(last, "")
	}

	found, prev, anchorPos, next, err := u.repo.SiblingPositionsAround(
		ctx, in.WorkspaceID, targetSpaceID, in.NewParentID, in.Anchor, in.PageID,
	)
	if err != nil {
		return "", err
	}
	if !found {
		// 指定された隣が、その親の現役の子ではない。**末尾へ落とさない** —
		// 利用者が落とした場所と違う場所に入り、しかも成功したように見える。
		return "", ErrPageAnchorNotSibling
	}
	if in.AnchorBefore {
		return fracindex.Between(prev, anchorPos)
	}
	return fracindex.Between(anchorPos, next)
}

func (u *MovePageUseCase) Execute(ctx context.Context, in MovePageInput) (*domain.Page, error) {
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}

	var targetSpaceID string
	if in.NewParentID != nil {
		if *in.NewParentID == in.PageID {
			return nil, ErrPageCycle
		}
		parent, err := u.repo.FindPage(ctx, in.WorkspaceID, *in.NewParentID)
		if err != nil {
			return nil, err
		}
		if parent.ArchivedAt != nil {
			return nil, ErrPageParentArchived
		}
		if in.NewSpaceID != "" && in.NewSpaceID != parent.SpaceID {
			return nil, ErrPageParentSpaceMismatch
		}
		targetSpaceID = parent.SpaceID
		// 新しい親が自分の子孫だと木が根から切り離されて循環する。closure（page_paths）の
		// 1 回の存在確認で検出する（depth=0 の自分自身も含まれる）。
		isDesc, err := u.repo.HasDescendant(ctx, in.WorkspaceID, in.PageID, *in.NewParentID)
		if err != nil {
			return nil, err
		}
		if isDesc {
			return nil, ErrPageCycle
		}
	} else {
		targetSpaceID = in.NewSpaceID
		if targetSpaceID == "" {
			targetSpaceID = page.SpaceID
		}
		if targetSpaceID != page.SpaceID {
			// 別スペースのルートへ移す場合のみ、移動先スペースの実在を確認する
			// （同一スペースなら page 自身の存在が実在の証明になっている）。
			if _, err := u.repo.FindSpace(ctx, in.WorkspaceID, targetSpaceID); err != nil {
				return nil, err
			}
		}
	}

	pos, err := u.placementPosition(ctx, in, targetSpaceID)
	if err != nil {
		return nil, err
	}
	if err := u.repo.MovePage(ctx, in.WorkspaceID, in.PageID, in.NewParentID, targetSpaceID, pos); err != nil {
		return nil, err
	}
	return u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
}

// ArchivePageUseCase はページとその子孫をまとめてアーカイブする（ツリーから隠す）。
// 既にアーカイブ済みなら何もしない（冪等）。
type ArchivePageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewArchivePageUseCase(r repository.KnowledgeBaseRepository) *ArchivePageUseCase {
	return &ArchivePageUseCase{repo: r}
}

type ArchivePageInput struct {
	WorkspaceID string
	PageID      string
}

func (u *ArchivePageUseCase) Execute(ctx context.Context, in ArchivePageInput) error {
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return err
	}
	if page.ArchivedAt != nil {
		return nil // 冪等: 二重アーカイブで子孫の archived_at を上書きしない
	}
	return u.repo.ArchivePageSubtree(ctx, in.WorkspaceID, in.PageID)
}

// UnarchivePageUseCase はアーカイブしたページを（同時にアーカイブされた子孫ごと）現役へ戻す。
// 部分 UNIQUE は現役の並びだけを守るため、アーカイブ中に同じ position の兄弟ができていたら
// 末尾へ再採番してから戻す。親がまだアーカイブ中の場合は戻せない（ツリーに現れない
// 「迷子ページ」を作らないため、先に親を戻す運用）。
type UnarchivePageUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewUnarchivePageUseCase(r repository.KnowledgeBaseRepository) *UnarchivePageUseCase {
	return &UnarchivePageUseCase{repo: r}
}

type UnarchivePageInput struct {
	WorkspaceID string
	PageID      string
}

func (u *UnarchivePageUseCase) Execute(ctx context.Context, in UnarchivePageInput) (*domain.Page, error) {
	page, err := u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt == nil {
		return page, nil // 冪等
	}
	if page.ParentID != nil {
		parent, err := u.repo.FindPage(ctx, in.WorkspaceID, *page.ParentID)
		if err != nil {
			return nil, err
		}
		if parent.ArchivedAt != nil {
			return nil, ErrPageParentArchived
		}
	}
	var newPos *string
	conflicted, err := u.repo.HasActiveSiblingPosition(ctx, in.WorkspaceID, page.SpaceID, page.ParentID, page.Position, page.ID)
	if err != nil {
		return nil, err
	}
	if conflicted {
		last, err := u.repo.LastActiveSiblingPosition(ctx, in.WorkspaceID, page.SpaceID, page.ParentID)
		if err != nil {
			return nil, err
		}
		pos, err := fracindex.Between(last, "")
		if err != nil {
			return nil, err
		}
		newPos = &pos
	}
	if err := u.repo.UnarchivePageSubtree(ctx, in.WorkspaceID, in.PageID, *page.ArchivedAt, newPos); err != nil {
		return nil, err
	}
	return u.repo.FindPage(ctx, in.WorkspaceID, in.PageID)
}

// kbPageRefNodeType は本文中の「ページ参照」インラインノードの type 名。
// エディタ側のスキーマ（PageRef）と一致させる。参照は attrs.pageId でページを指し、
// attrs.title は**表示のための派生値**で正本ではない — 正本は pages.title で、
// この usecase が読み出しのたびに引き直す。
const kbPageRefNodeType = "pageRef"

// kbPageRefMaxResolve は 1 ドキュメントで題名を解決する参照数の天井。
// 超えた分は保存されている文字のまま出す（読めなくなるわけではない）。
// 本文に数百の参照が並ぶのは異常系で、そこに可視判定のコストを払わない。
const kbPageRefMaxResolve = 100

// kbTicketRefNodeType は本文中の「チケット埋め込み」インラインノードの type 名
// （段 5）。usecase/ticket/doc.go の ticketTicketRefNodeType と同じ値・同じ形
// （attrs.ticketId で指す）。チケット本文（ticket_ticket_links）・ページ本文
// （page_ticket_links）の両方で同じノード型を使い回す。
const kbTicketRefNodeType = "ticketRef"

// ResolvePageRefTitlesUseCase は本文（ProseMirror doc）中のページ参照の題名を、
// 読み手にとっての「いまの題名」へ差し替える。
//
// 差し替えるのは**読み手が閲覧できる現役ページ**の参照だけ。閲覧できない・存在しない・
// アーカイブ済み・他ワークスペースの参照には題名を入れない（保存側が題名を持たない —
// StripPageRefTitles 参照 — ので、表示は「ページ」の代替文字に落ちる）。
//
// 解決は本文を壊さない: 読めない doc・事実の取得失敗はどちらも元の doc を返す（題名は
// 表示の飾りで、本文が開けることの方が重い）。ただし取得失敗の error は呼び出し側へ返し、
// 握り潰す判断は handler に委ねる。
type ResolvePageRefTitlesUseCase struct {
	perms repository.KnowledgeBasePermissionRepository
}

func NewResolvePageRefTitlesUseCase(r repository.KnowledgeBasePermissionRepository) *ResolvePageRefTitlesUseCase {
	return &ResolvePageRefTitlesUseCase{perms: r}
}

type ResolvePageRefTitlesInput struct {
	WorkspaceID string
	UserID      uint64
	// Doc は ProseMirror ドキュメント（JSON 文字列）。
	Doc string
}

func (u *ResolvePageRefTitlesUseCase) Execute(ctx context.Context, in ResolvePageRefTitlesInput) (string, error) {
	var root any
	if err := json.Unmarshal([]byte(in.Doc), &root); err != nil {
		// 読めない doc は「解決できない」ではなく「解決の対象が無い」。エラーにしない
		// （保存経路が別途 400 で弾いており、ここで返しても呼び出し側にできることが無い）。
		return in.Doc, nil //nolint:nilerr // 意図した劣化: 本文の読み出しを題名の都合で止めない
	}
	collector := newPageRefCollector()
	collector.collect(root)
	if len(collector.ids) == 0 {
		return in.Doc, nil
	}
	// 参照があるなら、まず保存されている title を全部剥がす。保存側（StripPageRefTitles）も
	// 剥がすが、それは新しい保存にしか効かず、それ以前に保存された doc には古い題名が
	// 残ったままになる。読み出し側でも剥がすことで、返る題名は必ず**この読み手の**
	// 可視判定を通った現在の値だけになる。
	stripped := stripPageRefTitlesNode(root)

	render := func() (string, bool) {
		out, err := json.Marshal(root)
		if err != nil {
			return in.Doc, false
		}
		return string(out), true
	}

	rows, err := u.perms.ListWorkspacePageViewFactsByIDs(ctx, in.WorkspaceID, in.UserID, collector.ids)
	if err != nil {
		if stripped {
			if out, ok := render(); ok {
				return out, err
			}
		}
		return in.Doc, err
	}
	titles := make(map[string]string, len(rows))
	for _, row := range rows {
		// アーカイブ済みは題名に採らない（隠したページの現在の題名を本文へ映さない —
		// 検索が現役だけを対象にするのと同じ線引き）。パンくず側は逆に含める。
		if row.Page.ArchivedAt != nil {
			continue
		}
		if domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			titles[row.Page.ID] = row.Page.Title
		}
	}
	rewritten := rewritePageRefTitles(root, titles)
	if !stripped && !rewritten {
		return in.Doc, nil
	}
	out, ok := render()
	if !ok {
		return in.Doc, nil
	}
	return out, nil
}

// StripPageRefTitles は保存前の doc からページ参照の title を取り除く。
//
// title は**読み手ごとに**読み出し時へ解決する派生値で、保存してはいけない。
// 保存すると、閲覧できる編集者の画面で解決された現在の題名が、その人の通常の
// 保存 1 回で本文へ焼き込まれ、閲覧できない読み手にもそのまま返ってしまう
// （読み出し時の可視判定を素通りする抜け道になる）。
//
// 参照が無い・読めない doc は元のまま返す（読めない doc は保存経路の検証が弾く）。
func StripPageRefTitles(doc string) string {
	var root any
	if err := json.Unmarshal([]byte(doc), &root); err != nil {
		return doc
	}
	if !stripPageRefTitlesNode(root) {
		return doc
	}
	out, err := json.Marshal(root)
	if err != nil {
		return doc
	}
	return string(out)
}

func stripPageRefTitlesNode(node any) bool {
	changed := false
	switch v := node.(type) {
	case map[string]any:
		if v["type"] == kbPageRefNodeType {
			if attrs, ok := v["attrs"].(map[string]any); ok {
				if _, has := attrs["title"]; has && attrs["title"] != nil {
					attrs["title"] = nil
					changed = true
				}
			}
		}
		if stripPageRefTitlesNode(v["content"]) {
			changed = true
		}
	case []any:
		for _, child := range v {
			if stripPageRefTitlesNode(child) {
				changed = true
			}
		}
	}
	return changed
}

// kbTemplateExcludedNodeTypes は「雛形として保存」で本文の木から丸ごと取り除くノードの type 名。
// pageRef は特定の 1 ページへの固定参照で、雛形が複数のページに展開されると全展開先が
// 同じ参照先を指してしまい意味をなさない。画像（domain.BlockTypeImage）はページ固有の
// オブジェクトストレージ key（kbImageKeyPrefix）に紐づき、雛形経由で複製すると元ページの
// 画像が消えたときにコピー側だけ宙に浮いた参照が残る。どちらも意図的に除外する。
var kbTemplateExcludedNodeTypes = map[string]bool{
	kbPageRefNodeType:             true,
	string(domain.BlockTypeImage): true,
}

// stripPageRefAndImageNodesForTemplate は「雛形として保存」の直前に、本文の木から
// pageRef ノードと画像ノードを丸ごと取り除く（StripPageRefTitles のように属性を null に
// 落とすのではなく、ノードそのものを content 配列から除く。除外理由は
// kbTemplateExcludedNodeTypes 参照）。取り除いた結果、空になった段落等が残ってもよい。
func stripPageRefAndImageNodesForTemplate(doc string) (string, error) {
	var root any
	if err := json.Unmarshal([]byte(doc), &root); err != nil {
		return "", fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
	}
	out, err := json.Marshal(stripTemplateExcludedNodes(root))
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// stripTemplateExcludedNodes は node を再帰的に歩き、content 配列から
// kbTemplateExcludedNodeTypes に含まれる type のノードを除いた値を返す。
// StripPageRefTitles の木の走査パターン（map[string]any / []any を直接歩く）を踏襲する。
func stripTemplateExcludedNodes(node any) any {
	switch v := node.(type) {
	case map[string]any:
		if content, ok := v["content"]; ok {
			v["content"] = stripTemplateExcludedNodes(content)
		}
		return v
	case []any:
		out := make([]any, 0, len(v))
		for _, child := range v {
			if m, ok := child.(map[string]any); ok {
				if t, _ := m["type"].(string); kbTemplateExcludedNodeTypes[t] {
					continue
				}
			}
			out = append(out, stripTemplateExcludedNodes(child))
		}
		return out
	default:
		return node
	}
}

// regenerateBlockIDs は「雛形からページを作る」の直前に、本文の木からブロックノードの
// attrs.id をすべて削除する（null 化ではなくキー自体を消す）。id が無いノードは
// parseBlockNode が新しい UUID を採番する既存の挙動にそのまま任せる。
//
// 削除しないままだと、同じ雛形から複数のページを作ったときに blocks.id
// （グローバルに一意な PK）が衝突し、2 ページ目以降の保存が失敗する。
func regenerateBlockIDs(doc string) (string, error) {
	var root any
	if err := json.Unmarshal([]byte(doc), &root); err != nil {
		return "", fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
	}
	stripNodeIDs(root)
	out, err := json.Marshal(root)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// stripNodeIDs は node を再帰的に歩き、各ノードの attrs から "id" キーを削除する
// （map を直接書き換える）。inline ノード（text・pageRef 等）はそもそも attrs.id という
// 概念を持たない（parseBlockNode が id を見るのはブロックノードの attrs だけ）ため、
// 区別せず全ノードへ同じ処理をかけても安全。
func stripNodeIDs(node any) {
	switch v := node.(type) {
	case map[string]any:
		if attrs, ok := v["attrs"].(map[string]any); ok {
			delete(attrs, "id")
		}
		stripNodeIDs(v["content"])
	case []any:
		for _, child := range v {
			stripNodeIDs(child)
		}
	}
}

// pageRefCollector は doc を歩いて pageRef の pageId を文書順・重複なしで集める。
// 重複判定は set（O(1)）、天井（kbPageRefMaxResolve）に達したら**収集自体を打ち切る**
// （線形走査や収集後の切り詰めだと、参照を大量に並べた本文で CPU を燃やせてしまう）。
// 辿るのは content 配列だけ（map の range だと順序が実行ごとに変わり天井の位置が不定になる）。
type pageRefCollector struct {
	ids  []string
	seen map[string]struct{}
}

func newPageRefCollector() *pageRefCollector {
	return &pageRefCollector{seen: map[string]struct{}{}}
}

func (c *pageRefCollector) collect(node any) {
	if len(c.ids) >= kbPageRefMaxResolve {
		return
	}
	switch v := node.(type) {
	case map[string]any:
		if v["type"] == kbPageRefNodeType {
			if attrs, ok := v["attrs"].(map[string]any); ok {
				if id, ok := attrs["pageId"].(string); ok {
					// UUID の正規形（小文字・ハイフン区切り）へ寄せてから数える。
					// repository も同じ正規化で照合するので、大文字や中括弧付きの
					// 表記で保存された参照もここで揃えないと、行は引けたのに
					// 題名の突き合わせだけが外れる。
					if canonical, ok := canonicalPageRefID(id); ok {
						if _, dup := c.seen[canonical]; !dup {
							c.seen[canonical] = struct{}{}
							c.ids = append(c.ids, canonical)
						}
					}
				}
			}
		}
		c.collect(v["content"])
	case []any:
		for _, child := range v {
			c.collect(child)
		}
	}
}

// rewritePageRefTitles は解決できた参照の title を書き換える。1 つでも書き換えたら true。
func rewritePageRefTitles(node any, titles map[string]string) bool {
	changed := false
	switch v := node.(type) {
	case map[string]any:
		if v["type"] == kbPageRefNodeType {
			if attrs, ok := v["attrs"].(map[string]any); ok {
				if id, ok := attrs["pageId"].(string); ok {
					if canonical, cok := canonicalPageRefID(id); cok {
						if title, found := titles[canonical]; found && attrs["title"] != title {
							attrs["title"] = title
							changed = true
						}
					}
				}
			}
		}
		if rewritePageRefTitles(v["content"], titles) {
			changed = true
		}
	case []any:
		for _, child := range v {
			if rewritePageRefTitles(child, titles) {
				changed = true
			}
		}
	}
	return changed
}

// canonicalPageRefID は参照の pageId を UUID の正規形（小文字・ハイフン区切り）へ寄せる。
// UUID として読めない値は参照として扱わない（repository 側の落とし方と揃える）。
func canonicalPageRefID(id string) (string, bool) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return "", false
	}
	return parsed.String(), true
}

// kbInlineTextNodeType は本文プレーンテキストに寄与するインラインノードの type 名。
const kbInlineTextNodeType = "text"

// kbInlineTextNode は inline 配列（葉ブロックの inline JSON）の 1 要素を最小限に読むための
// 型。text ノードは .text を、pageRef ノードは .attrs.pageId を持つ（他のフィールド・
// 他の type は無視する。マークの有無は本文プレーンテキストの抽出に関係ない）。
type kbInlineTextNode struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Attrs struct {
		PageID   string `json:"pageId"`
		TicketID string `json:"ticketId"`
	} `json:"attrs"`
}

// extractPageBodyText は本文検索用のプレーンテキストを抽出する。各葉ブロックの inline 内の
// "text" 型ノードの .text を連結し、ブロックの境目は改行（"\n"）で区切る。pageRef ノードは
// 寄与しない — 参照先の題名は読み手ごとに解決される派生値（StripPageRefTitles /
// ResolvePageRefTitlesUseCase 参照）で、保存本文に含めると「閲覧できない読み手のページも、
// その題名を通じて検索でヒットする」抜け道になる。
//
// 木は parsePageDoc が返す kbDocNode（保存直前・正規化済み）を対象にし、flattenPageDoc を
// 呼んだ**後**の木を渡すこと（呼び出し順は extractPageLinks と揃えてある）。容器ノード
// （kbContainerBlockTypes）は子を辿るだけで自身は何も出さない。中身が空の葉ブロック
// （Inline が nil）はスキップする。
func extractPageBodyText(nodes []*kbDocNode) string {
	var buf strings.Builder
	var walk func(nodes []*kbDocNode)
	walk = func(nodes []*kbDocNode) {
		for _, n := range nodes {
			if len(n.Children) > 0 {
				walk(n.Children)
				continue
			}
			if n.Inline == nil {
				continue
			}
			text := extractInlineText(*n.Inline)
			if text == "" {
				continue
			}
			if buf.Len() > 0 {
				buf.WriteByte('\n')
			}
			buf.WriteString(text)
		}
	}
	walk(nodes)
	return buf.String()
}

// extractInlineText は葉ブロック 1 つの inline JSON 配列から "text" 型ノードの .text を
// そのまま連結する（マークは無視。区切りは呼び出し側 extractPageBodyText が持つ）。
// 壊れた JSON（本来 parsePageDoc を通った直後の値なので起きない想定）は空文字にする。
func extractInlineText(inline string) string {
	var items []kbInlineTextNode
	if err := json.Unmarshal([]byte(inline), &items); err != nil {
		return ""
	}
	var buf strings.Builder
	for _, it := range items {
		if it.Type != kbInlineTextNodeType {
			continue
		}
		buf.WriteString(it.Text)
	}
	return buf.String()
}

// pageLinkRef は 1 本のページ内リンク候補（page_links の 1 行に対応する材料）。
// TargetPageID の実在確認はしていない — repository.ReplacePageBlocks が保存の直前に
// まとめて確認し、存在しない参照先は黙って除外する（リンク切れ 1 つのために本文の
// 保存自体を失敗させないため。repository.PageLinkWrite の doc 参照）。
type pageLinkRef struct {
	SourceBlockID string
	TargetPageID  string
}

// extractPageLinks は本文中の pageRef ノードから (ブロック id, 参照先ページ id) の組を
// 集める。pageRefCollector と同じ考え方（kbPageRefMaxResolve=100 を参照先ページの
// **種類数**の天井にする）だが、「どのブロックが参照しているか」を
// page_links.source_block_id として残す必要があるため kbDocNode の木を対象に書き直してある。
//
// 天井に達した後も走査そのものは止めない。既に種類として数えた参照先への追加のリンク
// （別のブロックからの再参照）まで取りこぼすと、逆リンクの一覧が保存のたびに部分的にしか
// 更新されない不安定な挙動になるため — 天井は「参照先ページの種類数」を絞るためのもので、
// 「そのページへの合計リンク本数」を絞るものではない。
//
// 同じブロックが同じページを複数回参照する場合は、ここで 1 行に畳む（呼び出し側の
// ON CONFLICT DO NOTHING でも畳まれるが、無駄な書き込みを事前に減らす）。
func extractPageLinks(nodes []*kbDocNode) []pageLinkRef {
	var links []pageLinkRef
	seenTarget := map[string]struct{}{}
	seenPair := map[[2]string]struct{}{}
	var walk func(nodes []*kbDocNode)
	walk = func(nodes []*kbDocNode) {
		for _, n := range nodes {
			if len(n.Children) > 0 {
				walk(n.Children)
				continue
			}
			if n.Inline == nil {
				continue
			}
			var items []kbInlineTextNode
			if err := json.Unmarshal([]byte(*n.Inline), &items); err != nil {
				continue
			}
			for _, it := range items {
				if it.Type != kbPageRefNodeType {
					continue
				}
				canonical, ok := canonicalPageRefID(it.Attrs.PageID)
				if !ok {
					continue
				}
				if _, known := seenTarget[canonical]; !known {
					if len(seenTarget) >= kbPageRefMaxResolve {
						continue
					}
					seenTarget[canonical] = struct{}{}
				}
				pair := [2]string{n.ID, canonical}
				if _, dup := seenPair[pair]; dup {
					continue
				}
				seenPair[pair] = struct{}{}
				links = append(links, pageLinkRef{SourceBlockID: n.ID, TargetPageID: canonical})
			}
		}
	}
	walk(nodes)
	return links
}

// pageTicketLinkRef は 1 本のページ内チケット埋め込み候補（page_ticket_links の 1 行に
// 対応する材料）。extractPageLinks の pageLinkRef と同じ役割・同じ制約
// （TargetTicketID の実在確認はしない。天井 kbPageRefMaxResolve を参照先の種類数に使う）。
type pageTicketLinkRef struct {
	SourceBlockID  string
	TargetTicketID string
}

// extractPageTicketLinks は本文中の ticketRef ノードから (ブロック id, 参照先チケット id) の
// 組を集める。extractPageLinks と全く同じ考え方・同じ天井を、対象ノード型だけ変えて
// 独立に実装している（1 回の走査で両方集める形にもできるが、pageRef / ticketRef は
// 保存頻度・呼び出し文脈が違う可能性を見込んで関数を分けておく — page_links /
// page_ticket_links を別の表にしているのと同じ理由）。
func extractPageTicketLinks(nodes []*kbDocNode) []pageTicketLinkRef {
	var links []pageTicketLinkRef
	seenTarget := map[string]struct{}{}
	seenPair := map[[2]string]struct{}{}
	var walk func(nodes []*kbDocNode)
	walk = func(nodes []*kbDocNode) {
		for _, n := range nodes {
			if len(n.Children) > 0 {
				walk(n.Children)
				continue
			}
			if n.Inline == nil {
				continue
			}
			var items []kbInlineTextNode
			if err := json.Unmarshal([]byte(*n.Inline), &items); err != nil {
				continue
			}
			for _, it := range items {
				if it.Type != kbTicketRefNodeType {
					continue
				}
				canonical, ok := canonicalPageRefID(it.Attrs.TicketID)
				if !ok {
					continue
				}
				if _, known := seenTarget[canonical]; !known {
					if len(seenTarget) >= kbPageRefMaxResolve {
						continue
					}
					seenTarget[canonical] = struct{}{}
				}
				pair := [2]string{n.ID, canonical}
				if _, dup := seenPair[pair]; dup {
					continue
				}
				seenPair[pair] = struct{}{}
				links = append(links, pageTicketLinkRef{SourceBlockID: n.ID, TargetTicketID: canonical})
			}
		}
	}
	walk(nodes)
	return links
}

// AncestorRef はパンくず 1 段分（ページ ID と現在の題名）。
type AncestorRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// ListViewableAncestorsUseCase はページの祖先のうち、読み手が閲覧できるものだけを
// 根から順に返す（パンくず用）。
//
// 見えない祖先は**行ごと出さない**（題名どころか実在も知らせない）。木が見えない親の
// 配下を出さないのと同じ規則で、可視の判定も同じ事実（ListWorkspacePageViewFactsByIDs +
// domain.ResolvePageView）を通す — パンくずだけ別の判定を持つと「木には出ないのに
// 道筋には出る」穴になるため。
//
// **アーカイブ済みの祖先は含める**（閲覧できる限り）。/p/{id} で開けるページを経路から
// 抜くと「その段が無い」かのように場所を偽ることになる。
type ListViewableAncestorsUseCase struct {
	pages repository.KnowledgeBaseRepository
	perms repository.KnowledgeBasePermissionRepository
}

func NewListViewableAncestorsUseCase(
	pages repository.KnowledgeBaseRepository,
	perms repository.KnowledgeBasePermissionRepository,
) *ListViewableAncestorsUseCase {
	return &ListViewableAncestorsUseCase{pages: pages, perms: perms}
}

type ListViewableAncestorsInput struct {
	WorkspaceID string
	UserID      uint64
	PageID      string
}

func (u *ListViewableAncestorsUseCase) Execute(ctx context.Context, in ListViewableAncestorsInput) ([]AncestorRef, error) {
	ids, err := u.pages.ListAncestorPageIDs(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []AncestorRef{}, nil
	}
	rows, err := u.perms.ListWorkspacePageViewFactsByIDs(ctx, in.WorkspaceID, in.UserID, ids)
	if err != nil {
		return nil, err
	}
	viewable := make(map[string]string, len(rows))
	for _, row := range rows {
		if domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			viewable[row.Page.ID] = row.Page.Title
		}
	}
	// 並びは closure の順（根から）を保つ。facts の応答順は題名順なので使わない。
	out := make([]AncestorRef, 0, len(ids))
	for _, id := range ids {
		if title, ok := viewable[id]; ok {
			out = append(out, AncestorRef{ID: id, Title: title})
		}
	}
	return out, nil
}
