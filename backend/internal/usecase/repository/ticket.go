package repository

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrTicketNotFound は対象チケットが存在しない（または別ワークスペース / 別プロジェクトのもの）
// ときに返す。テナント越えのアクセスも「無い」と同じ扱いにする（存在の有無を漏らさない）。
var ErrTicketNotFound = errors.New("ticket not found")

// ErrTicketStatusNotFound は対象の状態が存在しないときに返す。
var ErrTicketStatusNotFound = errors.New("ticket status not found")

// ErrTicketTypeNotFound は対象の種別が存在しないときに返す。
var ErrTicketTypeNotFound = errors.New("ticket type not found")

// ErrTicketsAlreadyEnabled は既に有効化済みのプロジェクトへ再度有効化しようとしたときに返す
// （「有効化済み」の正本は初期状態を持つ現役の状態が 1 つあること。設計 Ⅵ）。
var ErrTicketsAlreadyEnabled = errors.New("tickets already enabled for this space")

// ErrTicketStatusNameTaken / ErrTicketTypeNameTaken は現役の中で同名（大文字小文字を
// 区別しない）が既にあるときに返す（一意制約違反を repository が翻訳する）。
var (
	ErrTicketStatusNameTaken = errors.New("ticket status name is already taken")
	ErrTicketTypeNameTaken   = errors.New("ticket type name is already taken")
)

// ErrTicketAssigneeNotFound は担当に指定した principal が同じワークスペースに
// 実在しない（または kind='user' でない）ときに返す。
var ErrTicketAssigneeNotFound = errors.New("ticket assignee principal not found")

// ErrTicketNotDeleted は削除済み専用の操作（RestoreDeletedTicket）を、削除されていない
// チケットに対して呼んだときに返す（存在の有無を漏らさない方針で 404 に畳む）。
var ErrTicketNotDeleted = errors.New("ticket is not deleted")

// TicketCreateInput は CreateTicket に渡す入力。ID・Number は含めない
// （どちらも採番は repository（CreateTicket 実装内の CTE）の責務のため。設計 Ⅳ-B）。
type TicketCreateInput struct {
	WorkspaceID     string
	ProjectID       string
	TypeID          string
	StatusID        string
	ParentID        *string
	Title           string
	Doc             []byte
	PlainText       string
	Priority        domain.TicketPriority
	StartDate       *string
	DueDate         *string
	CreatedByUserID uint64
}

// TicketUpdateFields は UpdateTicket が書き換える列（部分更新）。StatusID / ClosedAt /
// Resolution は含めない（状態変更は専用メソッドを通し、category からの導出を 1 か所に閉じる）。
type TicketUpdateFields struct {
	TypeID    string
	ParentID  *string
	Title     string
	Doc       []byte
	PlainText string
	Priority  domain.TicketPriority
	// StoryPoints は見積り。nil は「未見積りにする」（0 にするのとは別物）。
	StoryPoints *int
	StartDate   *string
	DueDate     *string
}

// TicketWithAssignee はチケット 1 件と、その担当（principals への参照）の組。担当は別表
// （ticket_assignments）なので domain.Ticket には持たせず、SQL 側の LEFT JOIN で一緒に取る。
// 担当が居なければ AssigneePrincipalID は nil。
type TicketWithAssignee struct {
	Ticket              domain.Ticket
	AssigneePrincipalID *string
}

// ListTicketsInput は一覧の絞り込み条件。ゼロ値は「絞らない」を意味する。
type ListTicketsInput struct {
	WorkspaceID         string
	ProjectID           string
	IncludeArchived     bool
	StatusID            *string
	TypeID              *string
	AssigneePrincipalID *string
	// LabelID / DueBefore / StartAfter。DueBefore / StartAfter は 'YYYY-MM-DD' 文字列。
	LabelID    *string
	DueBefore  *string
	StartAfter *string
	// Unassigned / AssignedToMePrincipalID / Overdue / Q は保存した絞り込み・題名検索。
	// Unassigned・AssignedToMePrincipalID・AssigneePrincipalID は互いに排他（呼び出し側が
	// 検証する）。AssignedToMePrincipalID は「自分」の principal を usecase 側で解決済みの値
	// （フロントエンドに解決させない）。Q はタイトル・本文のあいまい検索（ILIKE + word_similarity。
	// ticket.sql の ListTickets 参照）。
	Unassigned              bool
	AssignedToMePrincipalID *string
	Overdue                 bool
	Q                       *string
	Limit                   int
	Offset                  int
}

type TicketList struct {
	Items []TicketWithAssignee
	Total int
}

// TicketCounts はバックログのサイドバー「保存した絞り込み」が表示する件数バッジ。
type TicketCounts struct {
	Total        int64
	AssignedToMe int64
	Overdue      int64
	Unassigned   int64
}

// TicketRepository はチケット（段 1: 骨格）の永続化を担う。1 boundary = 1 fat interface
// （KnowledgeBaseRepository と同じ方針）。
//
// 権限判定はここに含めない。チケットの実効権限はページを介さない「ワークスペース単位」の
// 判定で、既存の KnowledgeBasePermissionRepository.WorkspacePermissionFactsForUser が
// そのまま使える。usecase/ticket が両方の repository に依存し、チケットの実在確認だけを
// こちらの FindTicket に任せることで、同じ判定ロジックを SQL に二重化しない。
type TicketRepository interface {
	// --- 状態・種別（管理画面） ---

	// HasActiveInitialTicketStatus は「有効化済み」の判定に使う（初期状態を持つ現役の状態が
	// 1 つでもあるか）。
	HasActiveInitialTicketStatus(ctx context.Context, workspaceID, projectID string) (bool, error)
	InsertTicketStatus(ctx context.Context, s *domain.TicketStatus) error
	FindTicketStatus(ctx context.Context, workspaceID, projectID, statusID string) (*domain.TicketStatus, error)
	ListTicketStatuses(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketStatus, error)
	// GetInitialTicketStatus は新規チケット作成時の既定状態を解決する。
	GetInitialTicketStatus(ctx context.Context, workspaceID, projectID string) (*domain.TicketStatus, error)
	UpdateTicketStatus(ctx context.Context, s *domain.TicketStatus) error
	SetTicketStatusInitial(ctx context.Context, workspaceID, projectID, statusID string) error
	ArchiveTicketStatus(ctx context.Context, workspaceID, projectID, statusID string) error
	RestoreTicketStatus(ctx context.Context, workspaceID, projectID, statusID, position string) error
	CountActiveTicketsByStatus(ctx context.Context, workspaceID, projectID, statusID string) (int64, error)
	// CountActiveTicketsByStatusForProject はプロジェクト内の現役チケットを状態ごとに数えて
	// status_id -> 件数 の対応表で返す（管理画面の「使用中 N 件」用。1 回の GROUP BY で済ませ、
	// 状態の数だけ問い合わせない）。1 件も使われていない状態は対応表に現れない（0 とみなす）。
	CountActiveTicketsByStatusForProject(ctx context.Context, workspaceID, projectID string) (map[string]int64, error)
	LastActiveTicketStatusPosition(ctx context.Context, workspaceID, projectID string) (string, error)

	InsertTicketType(ctx context.Context, t *domain.TicketType) error
	FindTicketType(ctx context.Context, workspaceID, projectID, typeID string) (*domain.TicketType, error)
	ListTicketTypes(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketType, error)
	// GetDefaultTicketType は新規チケット作成時の既定種別を解決する。
	GetDefaultTicketType(ctx context.Context, workspaceID, projectID string) (*domain.TicketType, error)
	UpdateTicketType(ctx context.Context, t *domain.TicketType) error
	SetTicketTypeDefault(ctx context.Context, workspaceID, projectID, typeID string) error
	ArchiveTicketType(ctx context.Context, workspaceID, projectID, typeID string) error
	RestoreTicketType(ctx context.Context, workspaceID, projectID, typeID, position string) error
	CountActiveTicketsByType(ctx context.Context, workspaceID, projectID, typeID string) (int64, error)
	// CountActiveTicketsByTypeForProject は CountActiveTicketsByStatusForProject の種別版。
	CountActiveTicketsByTypeForProject(ctx context.Context, workspaceID, projectID string) (map[string]int64, error)
	LastActiveTicketTypePosition(ctx context.Context, workspaceID, projectID string) (string, error)

	// --- チケット本体 ---

	// CreateTicket は採番 CTE を含む 1 文で番号を払い出し、tickets へ 1 行作る。
	CreateTicket(ctx context.Context, in TicketCreateInput) (*domain.Ticket, error)
	// FindTicket はチケット 1 件を返す（担当は付かない）。権限判定・親子の検証など
	// 「その行が在るか・どのプロジェクトか」だけが要る内部用途に使う。画面へ返す取得は
	// FindTicketWithAssignee を使う。
	FindTicket(ctx context.Context, workspaceID, ticketID string) (*domain.Ticket, error)
	// FindTicketWithAssignee は詳細画面向けにチケット 1 件と担当を 1 回の問い合わせで返す。
	FindTicketWithAssignee(ctx context.Context, workspaceID, ticketID string) (*TicketWithAssignee, error)
	// FindTicketWorkspaceID はチケットを ID だけで引き所属ワークスペースを返す
	// （/kb/tickets/{ticketId} の URL からテナントを特定するための、workspace_id を
	// WHERE に持たない唯一の読み取り。引いた直後に必ずその workspace の権限判定を通す前提）。
	FindTicketWorkspaceID(ctx context.Context, ticketID string) (string, error)
	// ResolveTicketIDByKey は projectKey（小文字）+ number から ticket_id を引く
	// （domain.ParseTicketKey で分解した結果を渡す）。
	ResolveTicketIDByKey(ctx context.Context, workspaceID, projectKey string, number int64) (string, error)
	ListTickets(ctx context.Context, input ListTicketsInput) (TicketList, error)
	// CountTickets は ListTickets と同じ条件に合うチケットを数える（利用者が保存した絞り込みの
	// 件数バッジ用。一覧を引いてから数えると本文まで運ぶことになるので、数えるだけの経路を別に持つ）。
	CountTickets(ctx context.Context, in ListTicketsInput) (int64, error)
	// GetTicketCounts はサイドバー「保存した絞り込み」の件数バッジを 1 回で返す。
	// myPrincipalID が nil なら AssignedToMe は 0 になる。
	GetTicketCounts(ctx context.Context, workspaceID, projectID string, myPrincipalID *string) (TicketCounts, error)
	ListTicketChildren(ctx context.Context, workspaceID, projectID, parentID string) ([]domain.Ticket, error)
	UpdateTicket(ctx context.Context, workspaceID, ticketID string, fields TicketUpdateFields) (*domain.Ticket, error)
	// ChangeTicketStatus は closedAt / resolution を usecase 側で
	// domain.ResolveTicketClosedFields から導出した値をそのまま書く（ここでは判断しない）。
	ChangeTicketStatus(
		ctx context.Context, workspaceID, ticketID, statusID string,
		closedAt *time.Time, resolution *domain.TicketResolution,
	) (*domain.Ticket, error)
	ArchiveTicket(ctx context.Context, workspaceID, ticketID string) error
	RestoreTicket(ctx context.Context, workspaceID, ticketID string) error
	// DeleteTicket は「消えたことにする」（設計 Ⅳ-J）。子孫への伝播はここでは行わず、
	// 呼び出し側が続けて DeleteTicketPageLinksBySourceCascade /
	// DeleteTicketTicketLinksBySourceCascade を呼ぶ（DeleteTicketUseCase 参照）。
	DeleteTicket(ctx context.Context, workspaceID, ticketID string) error
	// FindDeletedTicket は削除済み（deleted_at IS NOT NULL）の行だけを引く
	// （RestoreDeletedTicketUseCase 専用。現役取得の FindTicket とは逆の絞り込み）。
	FindDeletedTicket(ctx context.Context, workspaceID, ticketID string) (*domain.Ticket, error)
	RestoreDeletedTicket(ctx context.Context, workspaceID, ticketID string) error
	CountActiveTicketChildren(ctx context.Context, workspaceID, ticketID string) (int64, error)
	// ListTicketParentChain は親を根まで辿った列（自分を含まない、根に近い順）を返す。
	// 深さ・周期・レベル整合性の検証に使う（ticket_paths は読み取り最適化用の派生表で、
	// 検証は今もこちらの再帰 CTE を使う。設計 Ⅳ-G）。
	ListTicketParentChain(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error)

	// --- 並び順（ticket_backlog_ranks） ---
	//
	// 並び順はこの表だけが持つ。かつて tickets.position が同じ値を持っていたが、
	// 並びの範囲（プロジェクト）を表せない場所に順序を置いていたので撤去した。

	// InsertTicketRank は CreateTicket 成功直後に usecase が呼ぶ（tickets への INSERT とは別文）。
	// projectID を取るのは、並びの範囲がプロジェクトであることを表の側にも書き込むため。
	InsertTicketRank(ctx context.Context, workspaceID, projectID, ticketID, position string) error
	MoveTicketRank(ctx context.Context, workspaceID, ticketID, position string) error
	// UpsertTicketRank は復元（アーカイブ解除・削除取り消し）で末尾へ置き直す。
	// 行が無いチケットにも効く（MoveTicketRank は 0 行で失敗する）。
	UpsertTicketRank(ctx context.Context, workspaceID, projectID, ticketID, position string) error
	// LastTicketRankPosition は末尾へ足すときの「いま一番後ろの鍵」。アーカイブ済み・
	// 削除済みの行も含めた最大値を返す —— 一意制約は表の行すべてに効くので、見えない行を
	// 無視して採番すると重複で落ちるため（queries/ticket.sql の同名クエリの doc 参照）。
	LastTicketRankPosition(ctx context.Context, workspaceID, projectID string) (string, error)

	// --- 担当 ---

	UpsertTicketAssignment(ctx context.Context, a *domain.TicketAssignment) error
	DeleteTicketAssignment(ctx context.Context, workspaceID, ticketID string) error
	FindTicketAssignment(ctx context.Context, workspaceID, ticketID string) (*domain.TicketAssignment, error)
	ListTicketsAssignedToPrincipal(ctx context.Context, workspaceID, principalID string) ([]domain.Ticket, error)

	// --- 監視（ticket_watchers）---

	// AddTicketWatcher は二重に押されても落とさない（もう監視しているのと同じ結果にする）。
	AddTicketWatcher(ctx context.Context, workspaceID, ticketID string, userID uint64) error
	RemoveTicketWatcher(ctx context.Context, workspaceID, ticketID string, userID uint64) error
	CountTicketWatchers(ctx context.Context, workspaceID, ticketID string) (int64, error)
	IsTicketWatchedBy(ctx context.Context, workspaceID, ticketID string, userID uint64) (bool, error)
	// ListAssignedTickets は「自分の担当」の画面向け。プロジェクトを横断し、表示に要る
	// 隣の値（プロジェクト・状態・種別）を同じ行で返す。並びは状態の枠 → 状態 → 期限。
	ListAssignedTickets(ctx context.Context, workspaceID, principalID string) ([]domain.AssignedTicket, error)
	// ListAssignedTicketsAcrossWorkspaces はホームの「自分の担当」向け。userID 本人に割り当たった
	// 未完了のチケットを、workspaceIDs の範囲で横断し、期限の近い順（期限なしは最後・同じなら
	// 作成の古い順 → id）に limit 件まで返す。workspaceIDs は呼び出し側が権限で絞ったもので、
	// ここでは判定しない。空なら問い合わせずに空を返す。
	ListAssignedTicketsAcrossWorkspaces(ctx context.Context, userID uint64, workspaceIDs []string, limit int) ([]domain.AssignedTicketSummary, error)

	// --- 変更履歴 ---

	// InsertTicketChangeGroup はグループと項目群を同一トランザクションで書く
	// （呼び出し側が usecase から TxManager.DoInTx で境界を引く）。
	InsertTicketChangeGroup(ctx context.Context, g *domain.TicketChangeGroup) error
	ListTicketChangeGroups(ctx context.Context, workspaceID, ticketID string) ([]domain.TicketChangeGroup, error)
	// InsertTicketStatusTransition は「いつどの状態にいたか」を集計する専用ログ（段 3・設計 Ⅵ）。
	// ChangeTicketStatusUseCase が InsertTicketChangeGroup と同じ状態変更で両方に書く。
	InsertTicketStatusTransition(
		ctx context.Context, workspaceID, projectID, ticketID, fromStatusID, toStatusID string, changedByUserID uint64,
	) error

	// --- 派生表（本文からの参照） ---

	// ReplaceTicketPageLinks / ReplaceTicketTicketLinks は本文保存のたびに張り替える。targetIDs は
	// 実在確認前の候補で、実在しない ID は黙って除外する（リンク切れ 1 本で保存全体を失敗させない。
	// ページ側と同じ方針）。
	ReplaceTicketPageLinks(ctx context.Context, workspaceID, sourceTicketID string, targetPageIDs []string) error
	ReplaceTicketTicketLinks(ctx context.Context, workspaceID, sourceTicketID string, targetTicketIDs []string) error
	// DeleteTicketPageLinksBySourceCascade / DeleteTicketTicketLinksBySourceCascade はチケット削除時に
	// DeleteTicketUseCase が呼ぶ（本文保存時の張り替え ReplaceXxxLinks とは別系統。設計 Ⅳ-J）。
	DeleteTicketPageLinksBySourceCascade(ctx context.Context, workspaceID, sourceTicketID string) error
	DeleteTicketTicketLinksBySourceCascade(ctx context.Context, workspaceID, sourceTicketID string) error
	ListTicketPageLinks(ctx context.Context, workspaceID, sourceTicketID string) ([]domain.TicketPageLink, error)
	// ListTicketsReferencingPage はページを参照しているチケットを、更新の新しい順に limit 件まで
	// 返す（アーカイブ・削除したものは除く）。一覧の 1 行に要る題名と表示キーだけで、本文は返さない。
	ListTicketsReferencingPage(ctx context.Context, workspaceID, pageID string, limit int) ([]domain.TicketReference, error)
	ListTicketTicketLinks(ctx context.Context, workspaceID, sourceTicketID string) ([]domain.TicketTicketLink, error)
	ListTicketsReferencingTicket(ctx context.Context, workspaceID, targetTicketID string) ([]domain.TicketTicketLink, error)

	// --- ticket_paths（段 5: parent_id の閉包表） ---

	// InsertTicketPathSelf / InsertTicketPathAncestors はチケット作成の直後に usecase が呼ぶ
	// （tickets への INSERT とは別文。InsertTicketRank と同じ流儀）。Ancestors は親があるときだけ呼ぶ。
	InsertTicketPathSelf(ctx context.Context, workspaceID, ticketID string) error
	InsertTicketPathAncestors(ctx context.Context, workspaceID, ticketID, parentID string) error
	// DetachTicketPathSubtree / AttachTicketPathSubtree は親の付け替え（ChangeTicketParentUseCase）
	// が呼ぶ。Detach は常に、Attach は新しい親があるときだけ呼ぶ（page_paths の MovePage と同じ形）。
	DetachTicketPathSubtree(ctx context.Context, workspaceID, ticketID string) error
	AttachTicketPathSubtree(ctx context.Context, workspaceID, ticketID, newParentID string) error
	// ListTicketAncestors はパンくず用（根から順、自分自身は含まない）。
	ListTicketAncestors(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error)
}
