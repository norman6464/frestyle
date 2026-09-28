package repository

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrWorkspaceNotFound は対象ワークスペースが存在しないときに返す。
var ErrWorkspaceNotFound = errors.New("workspace not found")

// ErrWorkspaceHasMembers は所属している人がいるワークスペースを消そうとしたときに返す。
// そこには全員のナレッジが入るので、1 人の操作で消せてよいはずがない。
var ErrWorkspaceHasMembers = errors.New("workspace still has members")

// ErrSpaceNotFound は対象スペースが存在しない（または別ワークスペースのもの）ときに返す。
var ErrSpaceNotFound = errors.New("space not found")

// ErrWorkspaceSlugTaken は作成しようとした slug が既に使われているときに返す
// （slug はグローバルに一意。どのテナントが使っているかは返さない）。
var ErrWorkspaceSlugTaken = errors.New("workspace slug is already taken")

// ErrSpaceKeyTaken は作成しようとした key が同じワークスペースで既に使われているときに返す。
var ErrSpaceKeyTaken = errors.New("space key is already taken")

// ErrPersonalWorkspaceAlreadyExists は、その人の個人ワークスペースを新規作成しようとした瞬間に
// 別のリクエストが先に作り終えていたときに返す（サインアップの二重送信等で起き得る競合）。
// 呼び出し側は失敗として扱わず、FindPersonalWorkspaceByOwner で先に作られた方を引き直す。
var ErrPersonalWorkspaceAlreadyExists = errors.New("personal workspace already exists for this user")

// ErrPageNotFound は対象ページが存在しない（または別ワークスペースのもの）ときに返す。
// テナント越えのアクセスは「無い」と同じ扱いにする（存在の有無自体を漏らさない）。
var ErrPageNotFound = errors.New("page not found")

// ErrPageMoveVoidsSpaceGrant は、移動するサブツリーに「スペース全員」宛てのページ付与が
// 残っている状態で、そのスペースの外へ移そうとしたときに返す。space_all の行は移動後も
// 残ったまま評価対象から外れ、**権限設定画面に見えているものと実効が違う**状態になり、
// 移動した本人にも気づけない。付与を先に整理してから移す運用に倒し、黙って権限が変わる
// 経路を塞ぐ。
var ErrPageMoveVoidsSpaceGrant = errors.New("page move would void a space-wide page grant")

// ErrPageSnapshotNotFound は対象ページの snapshot がまだ無いときに返す。
// snapshot は派生データなので、呼び出し側はこれを受けて blocks から組み立てる。
var ErrPageSnapshotNotFound = errors.New("page snapshot not found")

// ErrBlockIDConflict は ReplacePageBlocks で、そのページに新しく現れるはずの block id が
// 実は他のページに既に存在するときに返す（乗っ取り・バグの防止。id 単独の UPSERT では
// 本来なら他ページの行を書き換えられてしまうところを、保存ごと拒否して塞ぐ）。
var ErrBlockIDConflict = errors.New("block id conflict")

// PageLinkWrite は ReplacePageBlocks に渡す 1 件のページ内リンク候補（本文検索と逆リンク）。
// TargetPageID の実在確認はしていない — 存在しない参照先（リンク切れ）は repository 側が
// 保存の直前にまとめて確認し黙って除外する（1 本のリンク切れのために本文の保存自体を
// 失敗させないため。page_links.target_page_id は pages への FK）。
type PageLinkWrite struct {
	SourceBlockID string // page_links.source_block_id
	TargetPageID  string // page_links.target_page_id
}

// PageTicketLinkWrite は ReplacePageBlocks に渡す 1 件のページ内チケット埋め込み候補。
// PageLinkWrite のチケット版で、実在確認をしない理由も同一。
type PageTicketLinkWrite struct {
	SourceBlockID  string // page_ticket_links.source_block_id
	TargetTicketID string // page_ticket_links.target_ticket_id
}

// BlockWrite は ReplacePageBlocks に渡す 1 ブロック行。ID は usecase 側（flattenPageDoc）が
// 必ず埋める（クライアント指定の有効な UUID はそのまま使い、無ければ新規採番）。同じ id で
// 保存を繰り返す限り blocks.id は変わらない — comment_threads.block_id の FK が保存のたびに
// 外れないようにするための差分 UPSERT。
type BlockWrite struct {
	ID string
	// ParentID は親ブロックの ID。nil はページ直下（トップレベル）。
	ParentID *string
	// Position は兄弟内の並び順（分数インデックス）。
	Position string
	Type     domain.BlockType
	// Attrs は ProseMirror の attrs（JSON object 文字列。属性が無ければ "{}"）。
	Attrs string
	// Inline は葉ノードのインライン内容（JSON array 文字列）。容器ノードは nil。
	Inline *string
}

// KnowledgeBaseRepository はナレッジ（workspaces / spaces / pages / blocks /
// page_paths / page_snapshots）へのアクセスを提供する。ページ作成 = pages + page_paths、
// 本文保存 = blocks + snapshot のように複数テーブルを 1 トランザクションで書く操作が
// 中心のため、境界を分けずひとつの fat interface にまとめている。複数メソッドを 1 単位に
// するときは usecase が TxManager.DoInTx で境界を引き、実装は ctx の tx に相乗りする。
type KnowledgeBaseRepository interface {
	// FindPageByIDAcrossWorkspaces はページを ID だけで引く（/p/{pageId} の解決用）。
	// このリポジトリで唯一テナントを確定せずに読む口で、呼び出し側は結果を応答に使う前に
	// **必ずその workspace の権限判定を通す**。無ければ ErrPageNotFound。
	FindPageByIDAcrossWorkspaces(ctx context.Context, pageID string) (*domain.Page, error)
	// ListAncestorPageIDs はページの祖先 ID を根から順に返す（自分自身は含まない。
	// パンくず用の骨組み。題名・可視性は返さない）。
	ListAncestorPageIDs(ctx context.Context, workspaceID, pageID string) ([]string, error)
	// DeleteWorkspace はワークスペースを配下ごと消す。**所属している人がいるワークスペースは
	// 消さない**（その場合 ErrWorkspaceHasMembers）。対象が無ければ ErrWorkspaceNotFound。
	DeleteWorkspace(ctx context.Context, workspaceID string) error

	// FindWorkspaceByID はワークスペースを 1 件引く。無ければ ErrWorkspaceNotFound。
	FindWorkspaceByID(ctx context.Context, workspaceID string) (*domain.Workspace, error)
	// FindWorkspaceBySlug は URL に出る slug からワークスペースを引く。無ければ ErrWorkspaceNotFound。
	FindWorkspaceBySlug(ctx context.Context, slug string) (*domain.Workspace, error)
	// FindPersonalWorkspaceByOwner はそのユーザーの個人ワークスペースを引く（見つかれば
	// 必ず 1 件）。サインアップの「作る前に既に在るか見る」に使う。
	FindPersonalWorkspaceByOwner(ctx context.Context, userID uint64) (*domain.Workspace, error)
	// FindSpace はスペースを 1 件引く。無い・別ワークスペースなら ErrSpaceNotFound。
	FindSpace(ctx context.Context, workspaceID, spaceID string) (*domain.Space, error)
	// FindSpaceByIDAcrossWorkspaces はスペースを ID だけで引く（/kb/spaces/{spaceId} の解決用）。
	// FindPageByIDAcrossWorkspaces と同じく、テナントを確定せずに読む口。呼び出し側は結果を
	// 応答に使う前に**必ずその workspace の権限判定を通す**。無ければ ErrSpaceNotFound。
	FindSpaceByIDAcrossWorkspaces(ctx context.Context, spaceID string) (*domain.Space, error)
	// UpdateSpaceName はスペースの表示名だけを変える（key は不変）。
	UpdateSpaceName(ctx context.Context, workspaceID, spaceID, name string) error
	// CreateSpace はスペースを作成する（ID は UUIDv7 を採番。key が使用済みなら
	// ErrSpaceKeyTaken）。「全員」の主体（kind='space_all'）はここでは作らない —
	// EnsureSpaceEveryonePrincipal が必要な時点で作る。
	CreateSpace(ctx context.Context, space *domain.Space) error
	// FindPage はページを 1 件引く（アーカイブ済みも返す）。無い・別ワークスペースなら ErrPageNotFound。
	FindPage(ctx context.Context, workspaceID, pageID string) (*domain.Page, error)
	// ListActivePagesBySpace はスペース配下の現役ページ全件を position 順で返す（ツリー構築用）。
	ListActivePagesBySpace(ctx context.Context, workspaceID, spaceID string) ([]domain.Page, error)
	// ListAllWorkspaceIDs は全ワークスペースの id を返す（slug 順）。cmd/rebuildsearchindex
	// 専用（テナントを故意に跨ぐ唯一の口。通常の API 経路からは呼ばない）。
	ListAllWorkspaceIDs(ctx context.Context) ([]string, error)
	// ListActivePageIDsByWorkspace はワークスペース全体の現役ページ id を返す。
	// cmd/rebuildsearchindex 専用。
	ListActivePageIDsByWorkspace(ctx context.Context, workspaceID string) ([]string, error)
	// LastActiveSiblingPosition は兄弟（parentID が nil ならスペース直下）の末尾 position を返す。
	// 兄弟がいなければ空文字。
	LastActiveSiblingPosition(ctx context.Context, workspaceID, spaceID string, parentID *string) (string, error)
	// SiblingPositionsAround は「ある兄弟の隣に入れる」ための前後の並び順キーを返す
	// （ドラッグで落とした位置を表すのに使う）。クライアントは並び順のキーを持たないので
	// 「どの兄弟の隣か」をページの ID で受け取り、キーの計算はこちら側で閉じる。found が
	// false なら anchorPageID はその親の現役の子ではない。movingPageID は必ず除く
	// （動かす当人自身との中間値を計算しないため）。
	SiblingPositionsAround(
		ctx context.Context, workspaceID, spaceID string, parentID *string, anchorPageID, movingPageID string,
	) (found bool, prev, anchorPos, next string, err error)
	// HasActiveSiblingPosition は excludePageID 以外の現役の兄弟が position を使用中かを返す
	// （アーカイブ復帰時の衝突検出用）。
	HasActiveSiblingPosition(ctx context.Context, workspaceID, spaceID string, parentID *string, position, excludePageID string) (bool, error)
	// HasDescendant は candidateID が pageID の子孫（自分自身を含む）かを返す（移動の循環検出用）。
	HasDescendant(ctx context.Context, workspaceID, pageID, candidateID string) (bool, error)
	// CreatePage はページを作成する。ID は UUIDv7 を採番し、closure（自分自身 depth=0 +
	// 祖先の組）も同一トランザクションで張る。
	CreatePage(ctx context.Context, page *domain.Page) error
	// UpdatePageTitle はタイトルを変更し、更新後の行を返す。対象が無ければ ErrPageNotFound。
	UpdatePageTitle(ctx context.Context, workspaceID, pageID, title string) (*domain.Page, error)
	// UpdatePageIcon はアイコンを設定・解除し（icon が nil なら解除）、更新後の行を返す。
	// 対象が無ければ ErrPageNotFound。入力の妥当性は呼び出し側（usecase）が保証済みの前提。
	UpdatePageIcon(ctx context.Context, workspaceID, pageID string, icon *domain.PageIcon) (*domain.Page, error)
	// UpdatePageCover はカバー画像を設定・解除し（cover が nil なら解除）、更新後の行を返す。
	// 対象が無ければ ErrPageNotFound。archived_at IS NULL を WHERE に含める。
	UpdatePageCover(ctx context.Context, workspaceID, pageID string, cover *domain.PageCover) (*domain.Page, error)
	// UpdatePageVisibility は公開範囲を変更し、更新後の行を返す。対象が無ければ ErrPageNotFound。
	UpdatePageVisibility(ctx context.Context, workspaceID, pageID string, visibility domain.PageVisibility) (*domain.Page, error)
	// TouchPageLastEditedBy は最終編集者を記録する。対象が無ければ ErrPageNotFound。
	// 呼び出し側（ReplacePageBlocksUseCase）は本文の全消し全入れより**先に**これを呼ぶ —
	// UPDATE が pages の対象行を排他ロックするため、同じページへの同時保存がここで直列化される。
	TouchPageLastEditedBy(ctx context.Context, workspaceID, pageID string, userID uint64) error
	// MovePage はページを newParentID（nil はスペース直下）の末尾へ移す。pages の付け替え・
	// スペースが変わる場合のサブツリー space_id 更新・closure の付け替えを 1 トランザクションで
	// 行う。スペースをまたぐ移動で、移動先以外のスペースの「全員」宛てページ付与が残っている
	// 場合は ErrPageMoveVoidsSpaceGrant を返して移動しない。
	MovePage(ctx context.Context, workspaceID, pageID string, newParentID *string, newSpaceID, newPosition string) error
	// DeletePageSubtree はページを子孫ごと物理削除する（closure・blocks・snapshot も
	// CASCADE で消える。アーカイブと違い戻せない）。
	DeletePageSubtree(ctx context.Context, workspaceID, pageID string) error
	// ArchivePageSubtree はページとその子孫のうち現役の行に archived_at を設定する。
	// 既にアーカイブ済みの行は触らない。
	ArchivePageSubtree(ctx context.Context, workspaceID, pageID string) error
	// UnarchivePageSubtree はサブツリーのうち archivedSince 以降にアーカイブされた行を
	// 現役へ戻す。newRootPosition が非 nil なら解除前に根の position を振り直す
	// （現役の兄弟との衝突回避）。
	UnarchivePageSubtree(ctx context.Context, workspaceID, pageID string, archivedSince time.Time, newRootPosition *string) error
	// ListBlocksByPage はページの全ブロックを position 順で返す（doc への組み立て用）。
	ListBlocksByPage(ctx context.Context, workspaceID, pageID string) ([]domain.Block, error)
	// ReplacePageBlocks はページの全ブロックを blocks で置き換え、snapshot を snapshotDoc で
	// 焼き直す（全消し全入れ + UPSERT を 1 トランザクションで）。続けて page_search
	// （title / body）を UPSERT し page_links を張り替える。pageLinks/pageTicketLinks は
	// 本文から抽出した候補で、実在しない参照先は repository が黙って除外する。
	ReplacePageBlocks(
		ctx context.Context, workspaceID, pageID string, blocks []BlockWrite, snapshotDoc, title, body string,
		pageLinks []PageLinkWrite, pageTicketLinks []PageTicketLinkWrite,
	) error
	// GetPageSnapshot はページの snapshot を返す。無ければ ErrPageSnapshotNotFound。
	GetPageSnapshot(ctx context.Context, workspaceID, pageID string) (*domain.PageSnapshot, error)
	// RebuildPageSearchAndLinks は既存ページ 1 件について、その時点の blocks から
	// page_search / page_links を同期し直す（cmd/rebuildsearchindex 専用。DELETE + UPSERT で
	// 書き直すため冪等）。
	RebuildPageSearchAndLinks(ctx context.Context, workspaceID, pageID string) error
}
