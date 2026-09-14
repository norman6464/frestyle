package domain

import (
	"encoding/json"
	"time"
)

// Ticket はチケット（仕事 1 件を追いかける記録）本体。
//
// 表示キー（例 FRESTYLE-12）は保存しない派生値（FormatTicketKey が SpaceKey と Number から
// 組み立てる）。SpaceKey はこの構造体には無く、呼び出し側が spaces.key と組み合わせて
// 表示キーへ変換する（Page が SpaceID しか持たず Space 情報を別に引くのと同じ分担）。
// 所属はプロジェクト（バックログの入れ物）。ナレッジのスペースとは無関係。
//
// 本文（Doc）は ProseMirror の doc をそのまま jsonb で持つ（blocks には分解しない。設計 Ⅳ-E）。
// PlainText は pageRef / ticketRef の属性を含まない検索用の写しで、本文保存のたびに usecase が
// 作り直す派生値。
type Ticket struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspaceId"`
	ProjectID   string `json:"projectId"`
	// Number はプロジェクト内で一意な連番。表示キーの一部。直接 INSERT せず、必ず採番 CTE
	// （CreateTicket クエリ）を経由する。
	Number   int64  `json:"number"`
	TypeID   string `json:"typeId"`
	StatusID string `json:"statusId"`
	// ParentID は親チケット。NULL はトップレベル。同じプロジェクトのチケットに限る（DB の複合 FK）。
	// 階層規則（設計 Ⅳ-D）は ValidateTicketParentChild が持つ。
	ParentID *string         `json:"parentId,omitempty"`
	Title    string          `json:"title"`
	Doc      json.RawMessage `json:"doc"`
	// PlainText は一覧・検索の派生値。API では返さない（handler の response で除外する）。
	PlainText string `json:"-"`
	// Priority は 1=高 / 2=中 / 3=低。既定は TicketPriorityDefault。
	Priority TicketPriority `json:"priority"`
	// StoryPoints は見積りの大きさ。未見積りは nil（0 とは別物 —— 0 は「やることが無い」、
	// nil は「まだ測っていない」）。刻み方は現場ごとなので値そのものは縛らない（上限だけ）。
	StoryPoints *int `json:"storyPoints,omitempty"`
	// StartDate / DueDate は 'YYYY-MM-DD' の文字列（Ⅳ-K: time.Time だと本番の simple protocol
	// で 1 日ずれるため）。
	StartDate *string `json:"startDate,omitempty"`
	DueDate   *string `json:"dueDate,omitempty"`
	// Position は同一プロジェクト内の並び順（fracindex）。値は ticket_backlog_ranks 由来で、
	// 並び順を引かない経路（祖先・参照元の一覧、書き換えの応答）では空文字になる
	// —— 空を「先頭」と読んで並べ替えに使わないこと（並べ替えは DB の ORDER BY が正）。
	Position string `json:"position"`
	// ClosedAt / Resolution は対（片方だけが NULL にはならない。ck_tickets_closed_pair）。
	// 状態変更 usecase だけが書く（ResolveTicketClosedFields で category から導出する）。
	ClosedAt   *time.Time        `json:"closedAt,omitempty"`
	Resolution *TicketResolution `json:"resolution,omitempty"`
	// CreatedByUserID は報告者（users.id）。FK は張らない（pages と同じ分担）。
	CreatedByUserID uint64     `json:"createdByUserId"`
	ArchivedAt      *time.Time `json:"archivedAt,omitempty"`
	// DeletedAt は「消えたことにする」（設計 Ⅳ-J）。ArchivedAt とは別概念で、戻す口は
	// RestoreDeletedTicketUseCase だけ。現役取得系（FindTicket 系）はこれが立っている行を返さない。
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

// TicketStatus はスペースごとの状態。名前は自由、Category は 3 枠で固定（domain.go）。
// 遷移規則は持たない（誰でもどの状態にも変えられる。設計 Ⅳ-C）。
type TicketStatus struct {
	ID          string               `json:"id"`
	WorkspaceID string               `json:"workspaceId"`
	ProjectID   string               `json:"projectId"`
	Name        string               `json:"name"`
	Category    TicketStatusCategory `json:"category"`
	Color       string               `json:"color"`
	Position    string               `json:"position"`
	IsInitial   bool                 `json:"isInitial"`
	ArchivedAt  *time.Time           `json:"archivedAt,omitempty"`
	CreatedAt   time.Time            `json:"createdAt"`
	UpdatedAt   time.Time            `json:"updatedAt"`
}

// TicketType はスペースごとの種別。HierarchyLevel は階層の段（1=束ね/0=標準/-1=小作業）。
type TicketType struct {
	ID             string `json:"id"`
	WorkspaceID    string `json:"workspaceId"`
	ProjectID      string `json:"projectId"`
	Name           string `json:"name"`
	Color          string `json:"color"`
	HierarchyLevel int    `json:"hierarchyLevel"`
	Position       string `json:"position"`
	IsDefault      bool   `json:"isDefault"`
	// TemplateTitle / TemplateDoc は「雛形から作る」機能の元データ。NULL は雛形なし。
	TemplateTitle *string         `json:"templateTitle,omitempty"`
	TemplateDoc   json.RawMessage `json:"templateDoc,omitempty"`
	ArchivedAt    *time.Time      `json:"archivedAt,omitempty"`
	CreatedAt     time.Time       `json:"createdAt"`
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// TicketAssignment はチケットの担当者（1 人）。principals（ワークスペース所属の正本）への参照で
// 持つ。users.id を直接持たないのは、別ワークスペースの人を担当にできてしまう穴を DB 側の
// 複合 FK で防ぐため（設計 Ⅳ-G）。
type TicketAssignment struct {
	WorkspaceID         string    `json:"workspaceId"`
	TicketID            string    `json:"ticketId"`
	AssigneePrincipalID string    `json:"assigneePrincipalId"`
	AssignedByUserID    uint64    `json:"assignedByUserId"`
	CreatedAt           time.Time `json:"createdAt"`
}

// TicketChangeGroup は 1 回の保存でまとめて変わった項目の束（誰が・いつ）。
// Items は呼び出し側が別クエリの結果を詰めて組み立てる（DB 上は別表 ticket_change_items で、
// 1 グループ N 項目）。
type TicketChangeGroup struct {
	ID          string             `json:"id"`
	WorkspaceID string             `json:"workspaceId"`
	TicketID    string             `json:"ticketId"`
	ActorUserID uint64             `json:"actorUserId"`
	CreatedAt   time.Time          `json:"createdAt"`
	Items       []TicketChangeItem `json:"items"`
}

// TicketChangeItem は変更履歴の 1 項目（何を・前後の値・当時の表示名）。
// OldLabel / NewLabel は状態名・種別名などの表示用の写し。値そのもの（多くは ID）が指す先が
// 後で改名・アーカイブされても、履歴はこの写しで読める。
type TicketChangeItem struct {
	ID       string            `json:"id"`
	GroupID  string            `json:"groupId"`
	Field    TicketChangeField `json:"field"`
	OldValue *string           `json:"oldValue,omitempty"`
	NewValue *string           `json:"newValue,omitempty"`
	OldLabel *string           `json:"oldLabel,omitempty"`
	NewLabel *string           `json:"newLabel,omitempty"`
}

// TicketPageLink はチケット本文からページへの参照（派生表）。正本は Ticket.Doc の pageRef
// ノードで、この表は本文保存のたびに usecase が作り直す索引。壊れても本文から再生成できる
// （設計 Ⅳ-I）。
type TicketPageLink struct {
	WorkspaceID    string `json:"workspaceId"`
	SourceTicketID string `json:"sourceTicketId"`
	TargetPageID   string `json:"targetPageId"`
}

// TicketTicketLink はチケット本文から別チケットへの参照（派生表）。同上、正本は Ticket.Doc の
// ticketRef ノード。
type TicketTicketLink struct {
	WorkspaceID    string `json:"workspaceId"`
	SourceTicketID string `json:"sourceTicketId"`
	TargetTicketID string `json:"targetTicketId"`
}

// AssignedTicket は「自分の担当」の画面に出す 1 行。チケット本体に、**どのプロジェクトの
// 何の仕事か**を読むのに要る隣の値を添えたもの。
//
// Ticket をそのまま返さないのは、この画面がプロジェクトを横断するため。プロジェクト名も
// 状態名も行ごとに違い、画面側で引き直すと行数分の往復になる。逆に言えば、ここに足してよい
// のは「その行を読むのに要る値」だけ（編集に要る値はチケットを開いてから取る）。
type AssignedTicket struct {
	Ticket
	// ProjectKey は表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）。
	ProjectKey  string `json:"projectKey"`
	ProjectName string `json:"projectName"`
	// StatusName / StatusCategory / StatusColor は状態の見た目。束ねる見出しは Category で決め、
	// 名前と色はそのまま出す（状態はスペースごとに自由に足せるので、名前では束ねない）。
	StatusName     string               `json:"statusName"`
	StatusCategory TicketStatusCategory `json:"statusCategory"`
	StatusColor    string               `json:"statusColor"`
	TypeName       string               `json:"typeName"`
}
