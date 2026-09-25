package handler

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// チケット handler テスト用の in-memory fake（repository.TicketRepository）。
//
// kbFakePages / kbFakePerms と同じ考え方: 判定や採番の規則を fake が肩代わりしない
// （フィルタ・重複検査くらいはここで行うが、権限判定は一切持たない — permission_usecase.go が
// 使うのは kbFakePerms 側の SpacePermissionFactsForUser で、こちらとは別の依存）。
type ticketFakeRepo struct {
	statuses    map[string]*domain.TicketStatus
	types       map[string]*domain.TicketType
	tickets     map[string]*domain.Ticket
	assignments map[string]*domain.TicketAssignment   // ticketID -> assignment
	changes     map[string][]domain.TicketChangeGroup // ticketID -> グループ（追加順）
	pageLinks   map[string][]string                   // ticketID -> pageID
	ticketLinks map[string][]string                   // ticketID -> ticketID
	watchers    map[string]map[uint64]bool            // ticketID -> userID の集合
	nextID      int
	// numbers はプロジェクトごとの採番カウンタ（本番の ticket_counters の代わり）。
	numbers map[string]int64

	// 段 3: 発言・編集履歴・反応（TicketCommentRepository も同じ struct に実装する。
	// 別の fake 構造体に分けずに済ませる — 本番も別 repository だが同じ *sql.DB を指すのと
	// 同じ理由）。
	comments         map[string]*domain.TicketComment      // commentID -> comment
	commentEdits     map[string][]domain.TicketCommentEdit // commentID -> 編集履歴（追加順）
	commentReactions map[string][]domain.TicketCommentReaction

	// 段 4: ラベル・添付（LabelRepository / TicketAttachmentRepository も同じ struct に
	// 実装する。段 3 の comments と同じ判断）。
	labels       map[string]*domain.Label
	ticketLabels map[string][]string // ticketID -> labelID（追加順）
	attachments  map[string]*domain.TicketAttachment

	// 段13: ページへのラベル付け外し（labels の語彙を共有する page_labels 側。
	// LabelRepository のページ版メソッドもこの同じ struct に実装する — ticketLabels と同じ判断）。
	pageLabels map[string][]string // pageID -> labelID（追加順）

	// 利用者が保存した絞り込み（TicketSavedFilterRepository もこの同じ struct に実装する）。
	savedFilters map[string]*domain.TicketSavedFilter

	// 全ワークスペース横断の担当。並びと絞り込みは SQL の仕事なので、fake は用意された行を
	// 渡された範囲と件数で切って返し、渡された引数を記録するだけにする（結合テストが本物を見る）。
	assignedAcross      []domain.AssignedTicketSummary
	assignedAcrossCalls []assignedAcrossCall
}

type assignedAcrossCall struct {
	userID       uint64
	workspaceIDs []string
	limit        int
}

func newTicketFakeRepo() *ticketFakeRepo {
	return &ticketFakeRepo{
		statuses:         map[string]*domain.TicketStatus{},
		types:            map[string]*domain.TicketType{},
		tickets:          map[string]*domain.Ticket{},
		assignments:      map[string]*domain.TicketAssignment{},
		changes:          map[string][]domain.TicketChangeGroup{},
		pageLinks:        map[string][]string{},
		ticketLinks:      map[string][]string{},
		numbers:          map[string]int64{},
		comments:         map[string]*domain.TicketComment{},
		commentEdits:     map[string][]domain.TicketCommentEdit{},
		commentReactions: map[string][]domain.TicketCommentReaction{},
		labels:           map[string]*domain.Label{},
		ticketLabels:     map[string][]string{},
		attachments:      map[string]*domain.TicketAttachment{},
		pageLabels:       map[string][]string{},
		savedFilters:     map[string]*domain.TicketSavedFilter{},
	}
}

func (f *ticketFakeRepo) newID(prefix string) string {
	f.nextID++
	return fmt.Sprintf("%s-%04d", prefix, f.nextID)
}

// addStatus / addType はテストの下ごしらえ用（採番・一意性検査を経由しない直接投入）。
func (f *ticketFakeRepo) addStatus(s domain.TicketStatus) *domain.TicketStatus {
	stored := s
	f.statuses[s.ID] = &stored
	return &stored
}

func (f *ticketFakeRepo) addType(t domain.TicketType) *domain.TicketType {
	stored := t
	f.types[t.ID] = &stored
	return &stored
}

func (f *ticketFakeRepo) addTicket(t domain.Ticket) *domain.Ticket {
	if t.Doc == nil {
		t.Doc = []byte(`{"type":"doc","content":[]}`)
	}
	if t.Position == "" {
		t.Position = "a0"
	}
	stored := t
	f.tickets[t.ID] = &stored
	return &stored
}

// --- 状態 ---

func (f *ticketFakeRepo) HasActiveInitialTicketStatus(_ context.Context, workspaceID, projectID string) (bool, error) {
	for _, s := range f.statuses {
		if s.WorkspaceID == workspaceID && s.ProjectID == projectID && s.IsInitial && s.ArchivedAt == nil {
			return true, nil
		}
	}
	return false, nil
}

func (f *ticketFakeRepo) InsertTicketStatus(_ context.Context, s *domain.TicketStatus) error {
	for _, other := range f.statuses {
		if other.WorkspaceID == s.WorkspaceID && other.ProjectID == s.ProjectID && other.ArchivedAt == nil &&
			strings.EqualFold(other.Name, s.Name) {
			return repository.ErrTicketStatusNameTaken
		}
	}
	s.ID = f.newID("status")
	s.CreatedAt, s.UpdatedAt = time.Now(), time.Now()
	stored := *s
	f.statuses[s.ID] = &stored
	return nil
}

func (f *ticketFakeRepo) FindTicketStatus(_ context.Context, workspaceID, projectID, statusID string) (*domain.TicketStatus, error) {
	s, ok := f.statuses[statusID]
	if !ok || s.WorkspaceID != workspaceID || s.ProjectID != projectID {
		return nil, repository.ErrTicketStatusNotFound
	}
	cp := *s
	return &cp, nil
}

func (f *ticketFakeRepo) ListTicketStatuses(_ context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketStatus, error) {
	var out []domain.TicketStatus
	for _, s := range f.statuses {
		if s.WorkspaceID != workspaceID || s.ProjectID != projectID {
			continue
		}
		if s.ArchivedAt != nil && !includeArchived {
			continue
		}
		out = append(out, *s)
	}
	// 本番の SQL は ORDER BY "position"。呼び出し側（例: 並び替えの隣接探索）が
	// 順序に依存するので、map の走査順（毎プロセス起動でランダム化される）のまま返すと
	// -race の有無に関わらずテストが偶発的に落ちる（実測）。
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func (f *ticketFakeRepo) GetInitialTicketStatus(_ context.Context, workspaceID, projectID string) (*domain.TicketStatus, error) {
	for _, s := range f.statuses {
		if s.WorkspaceID == workspaceID && s.ProjectID == projectID && s.IsInitial && s.ArchivedAt == nil {
			cp := *s
			return &cp, nil
		}
	}
	return nil, repository.ErrTicketStatusNotFound
}

func (f *ticketFakeRepo) UpdateTicketStatus(_ context.Context, s *domain.TicketStatus) error {
	existing, ok := f.statuses[s.ID]
	if !ok || existing.WorkspaceID != s.WorkspaceID || existing.ProjectID != s.ProjectID {
		return repository.ErrTicketStatusNotFound
	}
	for _, other := range f.statuses {
		if other.ID != s.ID && other.WorkspaceID == s.WorkspaceID && other.ProjectID == s.ProjectID &&
			other.ArchivedAt == nil && strings.EqualFold(other.Name, s.Name) {
			return repository.ErrTicketStatusNameTaken
		}
	}
	existing.Name, existing.Category, existing.Color = s.Name, s.Category, s.Color
	existing.UpdatedAt = time.Now()
	*s = *existing
	return nil
}

func (f *ticketFakeRepo) SetTicketStatusInitial(_ context.Context, workspaceID, projectID, statusID string) error {
	s, ok := f.statuses[statusID]
	if !ok || s.WorkspaceID != workspaceID || s.ProjectID != projectID {
		return repository.ErrTicketStatusNotFound
	}
	for _, other := range f.statuses {
		if other.WorkspaceID == workspaceID && other.ProjectID == projectID {
			other.IsInitial = false
		}
	}
	s.IsInitial = true
	return nil
}

func (f *ticketFakeRepo) ArchiveTicketStatus(_ context.Context, workspaceID, projectID, statusID string) error {
	s, ok := f.statuses[statusID]
	if !ok || s.WorkspaceID != workspaceID || s.ProjectID != projectID {
		return repository.ErrTicketStatusNotFound
	}
	now := time.Now()
	s.ArchivedAt = &now
	return nil
}

func (f *ticketFakeRepo) RestoreTicketStatus(_ context.Context, workspaceID, projectID, statusID, position string) error {
	s, ok := f.statuses[statusID]
	if !ok || s.WorkspaceID != workspaceID || s.ProjectID != projectID {
		return repository.ErrTicketStatusNotFound
	}
	for _, other := range f.statuses {
		if other.ID != statusID && other.WorkspaceID == workspaceID && other.ProjectID == projectID &&
			other.ArchivedAt == nil && strings.EqualFold(other.Name, s.Name) {
			return repository.ErrTicketStatusNameTaken
		}
	}
	s.ArchivedAt = nil
	s.Position = position
	return nil
}

func (f *ticketFakeRepo) CountActiveTicketsByStatus(_ context.Context, workspaceID, projectID, statusID string) (int64, error) {
	var n int64
	for _, t := range f.tickets {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.StatusID == statusID && t.ArchivedAt == nil {
			n++
		}
	}
	return n, nil
}

func (f *ticketFakeRepo) CountActiveTicketsByStatusForProject(_ context.Context, workspaceID, projectID string) (map[string]int64, error) {
	out := map[string]int64{}
	for _, t := range f.tickets {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.ArchivedAt == nil {
			out[t.StatusID]++
		}
	}
	return out, nil
}

func (f *ticketFakeRepo) CountActiveTicketsByTypeForProject(_ context.Context, workspaceID, projectID string) (map[string]int64, error) {
	out := map[string]int64{}
	for _, t := range f.tickets {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.ArchivedAt == nil {
			out[t.TypeID]++
		}
	}
	return out, nil
}

func (f *ticketFakeRepo) LastActiveTicketStatusPosition(_ context.Context, workspaceID, projectID string) (string, error) {
	last := ""
	for _, s := range f.statuses {
		if s.WorkspaceID == workspaceID && s.ProjectID == projectID && s.ArchivedAt == nil && s.Position > last {
			last = s.Position
		}
	}
	return last, nil
}

// --- 種別 ---

func (f *ticketFakeRepo) InsertTicketType(_ context.Context, t *domain.TicketType) error {
	for _, other := range f.types {
		if other.WorkspaceID == t.WorkspaceID && other.ProjectID == t.ProjectID && other.ArchivedAt == nil &&
			strings.EqualFold(other.Name, t.Name) {
			return repository.ErrTicketTypeNameTaken
		}
	}
	t.ID = f.newID("type")
	t.CreatedAt, t.UpdatedAt = time.Now(), time.Now()
	stored := *t
	f.types[t.ID] = &stored
	return nil
}

func (f *ticketFakeRepo) FindTicketType(_ context.Context, workspaceID, projectID, typeID string) (*domain.TicketType, error) {
	t, ok := f.types[typeID]
	if !ok || t.WorkspaceID != workspaceID || t.ProjectID != projectID {
		return nil, repository.ErrTicketTypeNotFound
	}
	cp := *t
	return &cp, nil
}

func (f *ticketFakeRepo) ListTicketTypes(_ context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketType, error) {
	var out []domain.TicketType
	for _, t := range f.types {
		if t.WorkspaceID != workspaceID || t.ProjectID != projectID {
			continue
		}
		if t.ArchivedAt != nil && !includeArchived {
			continue
		}
		out = append(out, *t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func (f *ticketFakeRepo) GetDefaultTicketType(_ context.Context, workspaceID, projectID string) (*domain.TicketType, error) {
	for _, t := range f.types {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.IsDefault && t.ArchivedAt == nil {
			cp := *t
			return &cp, nil
		}
	}
	return nil, repository.ErrTicketTypeNotFound
}

func (f *ticketFakeRepo) UpdateTicketType(_ context.Context, t *domain.TicketType) error {
	existing, ok := f.types[t.ID]
	if !ok || existing.WorkspaceID != t.WorkspaceID || existing.ProjectID != t.ProjectID {
		return repository.ErrTicketTypeNotFound
	}
	for _, other := range f.types {
		if other.ID != t.ID && other.WorkspaceID == t.WorkspaceID && other.ProjectID == t.ProjectID &&
			other.ArchivedAt == nil && strings.EqualFold(other.Name, t.Name) {
			return repository.ErrTicketTypeNameTaken
		}
	}
	existing.Name, existing.Color, existing.HierarchyLevel = t.Name, t.Color, t.HierarchyLevel
	existing.UpdatedAt = time.Now()
	*t = *existing
	return nil
}

func (f *ticketFakeRepo) SetTicketTypeDefault(_ context.Context, workspaceID, projectID, typeID string) error {
	t, ok := f.types[typeID]
	if !ok || t.WorkspaceID != workspaceID || t.ProjectID != projectID {
		return repository.ErrTicketTypeNotFound
	}
	for _, other := range f.types {
		if other.WorkspaceID == workspaceID && other.ProjectID == projectID {
			other.IsDefault = false
		}
	}
	t.IsDefault = true
	return nil
}

func (f *ticketFakeRepo) ArchiveTicketType(_ context.Context, workspaceID, projectID, typeID string) error {
	t, ok := f.types[typeID]
	if !ok || t.WorkspaceID != workspaceID || t.ProjectID != projectID {
		return repository.ErrTicketTypeNotFound
	}
	now := time.Now()
	t.ArchivedAt = &now
	return nil
}

func (f *ticketFakeRepo) RestoreTicketType(_ context.Context, workspaceID, projectID, typeID, position string) error {
	t, ok := f.types[typeID]
	if !ok || t.WorkspaceID != workspaceID || t.ProjectID != projectID {
		return repository.ErrTicketTypeNotFound
	}
	for _, other := range f.types {
		if other.ID != typeID && other.WorkspaceID == workspaceID && other.ProjectID == projectID &&
			other.ArchivedAt == nil && strings.EqualFold(other.Name, t.Name) {
			return repository.ErrTicketTypeNameTaken
		}
	}
	t.ArchivedAt = nil
	t.Position = position
	return nil
}

func (f *ticketFakeRepo) CountActiveTicketsByType(_ context.Context, workspaceID, projectID, typeID string) (int64, error) {
	var n int64
	for _, t := range f.tickets {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.TypeID == typeID && t.ArchivedAt == nil {
			n++
		}
	}
	return n, nil
}

func (f *ticketFakeRepo) LastActiveTicketTypePosition(_ context.Context, workspaceID, projectID string) (string, error) {
	last := ""
	for _, t := range f.types {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.ArchivedAt == nil && t.Position > last {
			last = t.Position
		}
	}
	return last, nil
}

// --- チケット本体 ---

func (f *ticketFakeRepo) CreateTicket(_ context.Context, in repository.TicketCreateInput) (*domain.Ticket, error) {
	f.numbers[in.ProjectID]++
	t := &domain.Ticket{
		ID: f.newID("ticket"), WorkspaceID: in.WorkspaceID, ProjectID: in.ProjectID,
		Number: f.numbers[in.ProjectID], TypeID: in.TypeID, StatusID: in.StatusID, ParentID: in.ParentID,
		Title: in.Title, Doc: in.Doc, PlainText: in.PlainText, Priority: in.Priority,
		StartDate: in.StartDate, DueDate: in.DueDate,
		// Position は作らない。並び順は tickets ではなく ticket_backlog_ranks 側にあり、
		// 本物と同じく usecase が続けて InsertTicketRank で入れる（この fake ではそれが
		// Ticket.Position を埋める）。
		CreatedByUserID: in.CreatedByUserID, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	stored := *t
	f.tickets[t.ID] = &stored
	cp := *t
	return &cp, nil
}

func (f *ticketFakeRepo) FindTicket(_ context.Context, workspaceID, ticketID string) (*domain.Ticket, error) {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID || t.DeletedAt != nil {
		return nil, repository.ErrTicketNotFound
	}
	cp := *t
	return &cp, nil
}

func (f *ticketFakeRepo) FindTicketWithAssignee(ctx context.Context, workspaceID, ticketID string) (*repository.TicketWithAssignee, error) {
	t, err := f.FindTicket(ctx, workspaceID, ticketID)
	if err != nil {
		return nil, err
	}
	out := &repository.TicketWithAssignee{Ticket: *t}
	if a, ok := f.assignments[ticketID]; ok && a.WorkspaceID == workspaceID {
		id := a.AssigneePrincipalID
		out.AssigneePrincipalID = &id
	}
	return out, nil
}

func (f *ticketFakeRepo) FindTicketWorkspaceID(_ context.Context, ticketID string) (string, error) {
	t, ok := f.tickets[ticketID]
	if !ok {
		return "", repository.ErrTicketNotFound
	}
	return t.WorkspaceID, nil
}

func (f *ticketFakeRepo) ResolveTicketIDByKey(_ context.Context, workspaceID, projectKey string, number int64) (string, error) {
	for _, t := range f.tickets {
		if t.WorkspaceID != workspaceID || t.Number != number {
			continue
		}
		// fake ではプロジェクトの key をプロジェクト ID と同一視する（本番の
		// ResolveTicketIDByKey は projectKey → projectID の解決を
		// SQL の JOIN が担うが、fake はこの対応だけで足りる）。
		if t.ProjectID == projectKey {
			return t.ID, nil
		}
	}
	return "", repository.ErrTicketNotFound
}

// isOverdue は「期限が今日より前、かつ状態が完了(done)ではない」（GetTicketCounts.sql の
// overdue と同じ判定）。
func (f *ticketFakeRepo) isOverdue(t *domain.Ticket) bool {
	if t.DueDate == nil || *t.DueDate >= time.Now().Format("2006-01-02") {
		return false
	}
	s, ok := f.statuses[t.StatusID]
	return ok && s.Category != domain.TicketStatusCategoryDone
}

func (f *ticketFakeRepo) ListTickets(_ context.Context, input repository.ListTicketsInput) (repository.TicketList, error) {
	var out []repository.TicketWithAssignee
	for _, t := range f.tickets {
		if !f.matchesTicketFilter(t, input) {
			continue
		}
		row := repository.TicketWithAssignee{Ticket: *t}
		if a, ok := f.assignments[t.ID]; ok {
			id := a.AssigneePrincipalID
			row.AssigneePrincipalID = &id
		}
		out = append(out, row)
	}
	// MoveTicketUseCase.placementPosition が「隣の兄弟」を position 順の隣接として
	// 探すため、本番の SQL（ORDER BY t."position"）と同じ順序で返す必要がある
	// （順不同のままだと並び替えが偶発的に不正な範囲を fracindex.Between へ渡し、
	// テストが -race の有無に関わらずランダムに失敗する。実測）。
	sort.Slice(out, func(i, j int) bool { return out[i].Ticket.Position < out[j].Ticket.Position })
	list := repository.TicketList{Total: len(out)}
	if input.Offset > 0 {
		out = out[min(input.Offset, len(out)):]
	}
	if input.Limit > 0 && len(out) > input.Limit {
		out = out[:input.Limit]
	}
	list.Items = out
	return list, nil
}

func (f *ticketFakeRepo) matchesTicketFilter(t *domain.Ticket, input repository.ListTicketsInput) bool {
	if t.WorkspaceID != input.WorkspaceID || t.ProjectID != input.ProjectID {
		return false
	}
	if t.DeletedAt != nil {
		return false
	}
	if t.ArchivedAt != nil && !input.IncludeArchived {
		return false
	}
	if input.StatusID != nil && t.StatusID != *input.StatusID {
		return false
	}
	if input.TypeID != nil && t.TypeID != *input.TypeID {
		return false
	}
	if !f.matchesAssignee(t, input) {
		return false
	}
	if input.Overdue && !f.isOverdue(t) {
		return false
	}
	if input.Q != nil && !matchesQuery(t, *input.Q) {
		return false
	}
	if input.LabelID != nil && !f.hasLabel(t.ID, *input.LabelID) {
		return false
	}
	return withinDates(t, input)
}

func (f *ticketFakeRepo) matchesAssignee(t *domain.Ticket, input repository.ListTicketsInput) bool {
	a, assigned := f.assignments[t.ID]
	if input.AssigneePrincipalID != nil && (!assigned || a.AssigneePrincipalID != *input.AssigneePrincipalID) {
		return false
	}
	if input.Unassigned && assigned {
		return false
	}
	if input.AssignedToMePrincipalID != nil && (!assigned || a.AssigneePrincipalID != *input.AssignedToMePrincipalID) {
		return false
	}
	return true
}

func matchesQuery(t *domain.Ticket, q string) bool {
	q = strings.ToLower(q)
	return strings.Contains(strings.ToLower(t.Title), q) || strings.Contains(strings.ToLower(t.PlainText), q)
}

func (f *ticketFakeRepo) hasLabel(ticketID, labelID string) bool {
	for _, lID := range f.ticketLabels[ticketID] {
		if lID == labelID {
			return true
		}
	}
	return false
}

func withinDates(t *domain.Ticket, input repository.ListTicketsInput) bool {
	if input.DueBefore != nil && (t.DueDate == nil || *t.DueDate > *input.DueBefore) {
		return false
	}
	if input.StartAfter != nil && (t.StartDate == nil || *t.StartDate < *input.StartAfter) {
		return false
	}
	return true
}

func (f *ticketFakeRepo) GetTicketCounts(
	_ context.Context, workspaceID, projectID string, myPrincipalID *string,
) (repository.TicketCounts, error) {
	var c repository.TicketCounts
	for _, t := range f.tickets {
		if t.WorkspaceID != workspaceID || t.ProjectID != projectID || t.ArchivedAt != nil || t.DeletedAt != nil {
			continue
		}
		c.Total++
		a, hasAssignee := f.assignments[t.ID]
		if !hasAssignee {
			c.Unassigned++
		}
		if myPrincipalID != nil && hasAssignee && a.AssigneePrincipalID == *myPrincipalID {
			c.AssignedToMe++
		}
		if f.isOverdue(t) {
			c.Overdue++
		}
	}
	return c, nil
}

func (f *ticketFakeRepo) ListTicketChildren(_ context.Context, workspaceID, projectID, parentID string) ([]domain.Ticket, error) {
	var out []domain.Ticket
	for _, t := range f.tickets {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.ParentID != nil && *t.ParentID == parentID &&
			t.ArchivedAt == nil && t.DeletedAt == nil {
			out = append(out, *t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Position < out[j].Position })
	return out, nil
}

func (f *ticketFakeRepo) UpdateTicket(_ context.Context, workspaceID, ticketID string, fields repository.TicketUpdateFields) (*domain.Ticket, error) {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID {
		return nil, repository.ErrTicketNotFound
	}
	if _, ok := f.types[fields.TypeID]; !ok {
		return nil, repository.ErrTicketNotFound
	}
	t.TypeID, t.ParentID, t.Title = fields.TypeID, fields.ParentID, fields.Title
	t.Doc, t.PlainText, t.Priority = fields.Doc, fields.PlainText, fields.Priority
	t.StartDate, t.DueDate = fields.StartDate, fields.DueDate
	t.UpdatedAt = time.Now()
	cp := *t
	return &cp, nil
}

func (f *ticketFakeRepo) ChangeTicketStatus(
	_ context.Context, workspaceID, ticketID, statusID string,
	closedAt *time.Time, resolution *domain.TicketResolution,
) (*domain.Ticket, error) {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID {
		return nil, repository.ErrTicketNotFound
	}
	t.StatusID, t.ClosedAt, t.Resolution = statusID, closedAt, resolution
	t.UpdatedAt = time.Now()
	cp := *t
	return &cp, nil
}

func (f *ticketFakeRepo) ArchiveTicket(_ context.Context, workspaceID, ticketID string) error {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID || t.ArchivedAt != nil || t.DeletedAt != nil {
		return repository.ErrTicketNotFound
	}
	now := time.Now()
	t.ArchivedAt = &now
	return nil
}

func (f *ticketFakeRepo) RestoreTicket(_ context.Context, workspaceID, ticketID string) error {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID || t.ArchivedAt == nil || t.DeletedAt != nil {
		return repository.ErrTicketNotFound
	}
	t.ArchivedAt = nil
	return nil
}

func (f *ticketFakeRepo) DeleteTicket(_ context.Context, workspaceID, ticketID string) error {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID || t.DeletedAt != nil {
		return repository.ErrTicketNotFound
	}
	now := time.Now()
	t.DeletedAt = &now
	return nil
}

func (f *ticketFakeRepo) FindDeletedTicket(_ context.Context, workspaceID, ticketID string) (*domain.Ticket, error) {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID || t.DeletedAt == nil {
		return nil, repository.ErrTicketNotDeleted
	}
	cp := *t
	return &cp, nil
}

func (f *ticketFakeRepo) RestoreDeletedTicket(_ context.Context, workspaceID, ticketID string) error {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID || t.DeletedAt == nil {
		return repository.ErrTicketNotDeleted
	}
	t.DeletedAt = nil
	return nil
}

func (f *ticketFakeRepo) InsertTicketRank(_ context.Context, workspaceID, _, ticketID, position string) error {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID {
		return repository.ErrTicketNotFound
	}
	t.Position = position
	return nil
}

func (f *ticketFakeRepo) MoveTicketRank(_ context.Context, workspaceID, ticketID, position string) error {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID {
		return repository.ErrTicketNotFound
	}
	t.Position = position
	return nil
}

func (f *ticketFakeRepo) UpsertTicketRank(_ context.Context, workspaceID, _, ticketID, position string) error {
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID {
		return repository.ErrTicketNotFound
	}
	t.Position = position
	return nil
}

// LastTicketRankPosition は本物と同じく「見えない行も含めた最大値」を返す
// （アーカイブ済み・削除済みを除くと、その鍵を作り直して一意制約で落ちる）。
func (f *ticketFakeRepo) LastTicketRankPosition(_ context.Context, workspaceID, projectID string) (string, error) {
	last := ""
	for _, t := range f.tickets {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID && t.Position > last {
			last = t.Position
		}
	}
	return last, nil
}

func (f *ticketFakeRepo) CountActiveTicketChildren(_ context.Context, workspaceID, ticketID string) (int64, error) {
	var n int64
	for _, t := range f.tickets {
		if t.WorkspaceID == workspaceID && t.ParentID != nil && *t.ParentID == ticketID && t.ArchivedAt == nil {
			n++
		}
	}
	return n, nil
}

func (f *ticketFakeRepo) ListTicketParentChain(_ context.Context, workspaceID, ticketID string) ([]domain.Ticket, error) {
	var chain []domain.Ticket
	cur, ok := f.tickets[ticketID]
	if !ok || cur.WorkspaceID != workspaceID {
		return nil, repository.ErrTicketNotFound
	}
	for cur.ParentID != nil {
		parent, ok := f.tickets[*cur.ParentID]
		if !ok {
			break
		}
		chain = append([]domain.Ticket{*parent}, chain...)
		cur = parent
	}
	return chain, nil
}

// InsertTicketPathSelf / InsertTicketPathAncestors / DetachTicketPathSubtree /
// AttachTicketPathSubtree は no-op — この fake は閉包表を別に持たず、祖先は常に
// tickets の parent_id を辿って求める（ListTicketAncestors / ListTicketParentChain と
// 同じ由来）。本物の repository はキャッシュとして閉包表を持つが、fake はテストのために
// 常に最新の parent_id から計算するだけで足りる。
func (f *ticketFakeRepo) InsertTicketPathSelf(_ context.Context, _, _ string) error { return nil }

func (f *ticketFakeRepo) InsertTicketPathAncestors(_ context.Context, _, _, _ string) error {
	return nil
}

func (f *ticketFakeRepo) DetachTicketPathSubtree(_ context.Context, _, _ string) error { return nil }

func (f *ticketFakeRepo) AttachTicketPathSubtree(_ context.Context, _, _, _ string) error {
	return nil
}

// ListTicketAncestors は ListTicketParentChain と同じ根から順の並びを返す
// （fake は閉包表を持たないので同じ parent_id の辿り方を使い回す）。
func (f *ticketFakeRepo) ListTicketAncestors(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error) {
	return f.ListTicketParentChain(ctx, workspaceID, ticketID)
}

// --- 担当 ---

func (f *ticketFakeRepo) UpsertTicketAssignment(_ context.Context, a *domain.TicketAssignment) error {
	t, ok := f.tickets[a.TicketID]
	if !ok || t.WorkspaceID != a.WorkspaceID {
		return repository.ErrTicketNotFound
	}
	// fake における principal の実在確認: kbFakePerms が作る principal ID の形
	// （"principal-user-<workspaceID>-<userID>" 等）は fake ごとに閉じているため、ここでは
	// 「principalNotFound」を明示的に注入したテストケースだけを弾く単純化に留める。
	if a.AssigneePrincipalID == ticketFakeMissingPrincipalID {
		return repository.ErrTicketAssigneeNotFound
	}
	a.CreatedAt = time.Now()
	stored := *a
	f.assignments[a.TicketID] = &stored
	return nil
}

// ticketFakeMissingPrincipalID はテストが「実在しない担当」を表すのに使う予約値。
const ticketFakeMissingPrincipalID = "principal-missing"

func (f *ticketFakeRepo) DeleteTicketAssignment(_ context.Context, workspaceID, ticketID string) error {
	a, ok := f.assignments[ticketID]
	if !ok || a.WorkspaceID != workspaceID {
		return nil
	}
	delete(f.assignments, ticketID)
	return nil
}

func (f *ticketFakeRepo) FindTicketAssignment(_ context.Context, workspaceID, ticketID string) (*domain.TicketAssignment, error) {
	a, ok := f.assignments[ticketID]
	if !ok || a.WorkspaceID != workspaceID {
		return nil, nil
	}
	cp := *a
	return &cp, nil
}

// ListAssignedTickets は handler の検査用。隣の表の値（プロジェクト・状態・種別）は
// fake が持つ表から引き、引けなければ空のまま返す（行そのものは落とさない）。
func (f *ticketFakeRepo) ListAssignedTickets(_ context.Context, workspaceID, principalID string) ([]domain.AssignedTicket, error) {
	var out []domain.AssignedTicket
	for ticketID, a := range f.assignments {
		if a.WorkspaceID != workspaceID || a.AssigneePrincipalID != principalID {
			continue
		}
		t, ok := f.tickets[ticketID]
		if !ok || t.ArchivedAt != nil || t.DeletedAt != nil {
			continue
		}
		row := domain.AssignedTicket{Ticket: *t}
		if s, ok := f.statuses[t.StatusID]; ok {
			row.StatusName, row.StatusCategory, row.StatusColor = s.Name, s.Category, s.Color
		}
		if ty, ok := f.types[t.TypeID]; ok {
			row.TypeName = ty.Name
		}
		out = append(out, row)
	}
	return out, nil
}

func (f *ticketFakeRepo) ListAssignedTicketsAcrossWorkspaces(
	_ context.Context, userID uint64, workspaceIDs []string, limit int,
) ([]domain.AssignedTicketSummary, error) {
	f.assignedAcrossCalls = append(f.assignedAcrossCalls, assignedAcrossCall{
		userID: userID, workspaceIDs: append([]string(nil), workspaceIDs...), limit: limit,
	})
	out := []domain.AssignedTicketSummary{}
	for _, row := range f.assignedAcross {
		if len(out) == limit {
			break
		}
		out = append(out, row)
	}
	return out, nil
}

// 監視は「誰が・どのチケットを」の集合だけで足りる（fake は表ではなく map で持つ）。
func (f *ticketFakeRepo) AddTicketWatcher(_ context.Context, workspaceID, ticketID string, userID uint64) error {
	if f.watchers == nil {
		f.watchers = map[string]map[uint64]bool{}
	}
	t, ok := f.tickets[ticketID]
	if !ok || t.WorkspaceID != workspaceID {
		return repository.ErrTicketNotFound
	}
	if f.watchers[ticketID] == nil {
		f.watchers[ticketID] = map[uint64]bool{}
	}
	f.watchers[ticketID][userID] = true
	return nil
}

func (f *ticketFakeRepo) RemoveTicketWatcher(_ context.Context, _, ticketID string, userID uint64) error {
	if f.watchers != nil {
		delete(f.watchers[ticketID], userID)
	}
	return nil
}

func (f *ticketFakeRepo) CountTicketWatchers(_ context.Context, _, ticketID string) (int64, error) {
	return int64(len(f.watchers[ticketID])), nil
}

func (f *ticketFakeRepo) IsTicketWatchedBy(_ context.Context, _, ticketID string, userID uint64) (bool, error) {
	return f.watchers[ticketID][userID], nil
}

func (f *ticketFakeRepo) ListTicketsAssignedToPrincipal(_ context.Context, workspaceID, principalID string) ([]domain.Ticket, error) {
	var out []domain.Ticket
	for ticketID, a := range f.assignments {
		if a.WorkspaceID != workspaceID || a.AssigneePrincipalID != principalID {
			continue
		}
		if t, ok := f.tickets[ticketID]; ok {
			out = append(out, *t)
		}
	}
	return out, nil
}

// --- 変更履歴 ---

func (f *ticketFakeRepo) InsertTicketChangeGroup(_ context.Context, g *domain.TicketChangeGroup) error {
	g.ID = f.newID("change")
	g.CreatedAt = time.Now()
	for i := range g.Items {
		g.Items[i].ID = f.newID("item")
		g.Items[i].GroupID = g.ID
	}
	f.changes[g.TicketID] = append(f.changes[g.TicketID], *g)
	return nil
}

func (f *ticketFakeRepo) InsertTicketStatusTransition(
	_ context.Context, workspaceID, projectID, ticketID, fromStatusID, toStatusID string, changedByUserID uint64,
) error {
	// テストではこの表を検証しない（handler テストは status 変更の応答だけを見る）ので、
	// 何もせず成功扱いにする。
	return nil
}

func (f *ticketFakeRepo) ListTicketChangeGroups(_ context.Context, workspaceID, ticketID string) ([]domain.TicketChangeGroup, error) {
	groups := f.changes[ticketID]
	out := make([]domain.TicketChangeGroup, 0, len(groups))
	for i := len(groups) - 1; i >= 0; i-- {
		if groups[i].WorkspaceID == workspaceID {
			out = append(out, groups[i])
		}
	}
	return out, nil
}

// --- 派生表 ---

func (f *ticketFakeRepo) ReplaceTicketPageLinks(_ context.Context, workspaceID, sourceTicketID string, targetPageIDs []string) error {
	f.pageLinks[sourceTicketID] = targetPageIDs
	return nil
}

func (f *ticketFakeRepo) ReplaceTicketTicketLinks(_ context.Context, workspaceID, sourceTicketID string, targetTicketIDs []string) error {
	f.ticketLinks[sourceTicketID] = targetTicketIDs
	return nil
}

func (f *ticketFakeRepo) DeleteTicketPageLinksBySourceCascade(_ context.Context, workspaceID, sourceTicketID string) error {
	delete(f.pageLinks, sourceTicketID)
	return nil
}

func (f *ticketFakeRepo) DeleteTicketTicketLinksBySourceCascade(_ context.Context, workspaceID, sourceTicketID string) error {
	delete(f.ticketLinks, sourceTicketID)
	return nil
}

func (f *ticketFakeRepo) ListTicketPageLinks(_ context.Context, workspaceID, sourceTicketID string) ([]domain.TicketPageLink, error) {
	var out []domain.TicketPageLink
	for _, pageID := range f.pageLinks[sourceTicketID] {
		out = append(out, domain.TicketPageLink{WorkspaceID: workspaceID, SourceTicketID: sourceTicketID, TargetPageID: pageID})
	}
	return out, nil
}

// ListTicketsReferencingPage は並び（更新の新しい順）を SQL に任せ、fake では題名の順で安定させる。
// 並びの正しさは結合テストが見る。ここで見るのは可視判定と件数の受け渡しだけ。
func (f *ticketFakeRepo) ListTicketsReferencingPage(
	_ context.Context, workspaceID, pageID string, limit int,
) ([]domain.TicketReference, error) {
	out := []domain.TicketReference{}
	for ticketID, pageIDs := range f.pageLinks {
		t, ok := f.tickets[ticketID]
		if !ok || t.WorkspaceID != workspaceID || t.DeletedAt != nil || t.ArchivedAt != nil {
			continue
		}
		for _, pid := range pageIDs {
			if pid == pageID {
				out = append(out, domain.TicketReference{ID: t.ID, Number: t.Number, Title: t.Title})
				break
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Title < out[j].Title })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *ticketFakeRepo) ListTicketTicketLinks(_ context.Context, workspaceID, sourceTicketID string) ([]domain.TicketTicketLink, error) {
	var out []domain.TicketTicketLink
	for _, targetID := range f.ticketLinks[sourceTicketID] {
		out = append(out, domain.TicketTicketLink{WorkspaceID: workspaceID, SourceTicketID: sourceTicketID, TargetTicketID: targetID})
	}
	return out, nil
}

func (f *ticketFakeRepo) ListTicketsReferencingTicket(_ context.Context, workspaceID, targetTicketID string) ([]domain.TicketTicketLink, error) {
	var out []domain.TicketTicketLink
	for sourceID, targets := range f.ticketLinks {
		for _, targetID := range targets {
			if targetID == targetTicketID {
				out = append(out, domain.TicketTicketLink{WorkspaceID: workspaceID, SourceTicketID: sourceID, TargetTicketID: targetTicketID})
			}
		}
	}
	return out, nil
}

var _ repository.TicketRepository = (*ticketFakeRepo)(nil)

// --- repository.TicketCommentRepository（段 3） ---

func (f *ticketFakeRepo) CreateTicketComment(_ context.Context, c *domain.TicketComment) error {
	c.ID = f.newID("comment")
	c.CreatedAt, c.UpdatedAt = time.Now(), time.Now()
	stored := *c
	f.comments[c.ID] = &stored
	return nil
}

func (f *ticketFakeRepo) FindTicketComment(_ context.Context, workspaceID, ticketID, commentID string) (*domain.TicketComment, error) {
	c, ok := f.comments[commentID]
	if !ok || c.WorkspaceID != workspaceID || c.TicketID != ticketID || c.DeletedAt != nil {
		return nil, repository.ErrTicketCommentNotFound
	}
	cp := *c
	return &cp, nil
}

func (f *ticketFakeRepo) ListTicketComments(_ context.Context, workspaceID, ticketID string) ([]domain.TicketComment, error) {
	var out []domain.TicketComment
	for _, c := range f.comments {
		if c.WorkspaceID == workspaceID && c.TicketID == ticketID && c.DeletedAt == nil {
			out = append(out, *c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (f *ticketFakeRepo) UpdateTicketCommentBody(_ context.Context, workspaceID, ticketID, commentID, body string) (*domain.TicketComment, error) {
	c, ok := f.comments[commentID]
	if !ok || c.WorkspaceID != workspaceID || c.TicketID != ticketID || c.DeletedAt != nil {
		return nil, repository.ErrTicketCommentNotFound
	}
	now := time.Now()
	c.Body = body
	c.EditedAt = &now
	c.UpdatedAt = now
	cp := *c
	return &cp, nil
}

func (f *ticketFakeRepo) DeleteTicketComment(_ context.Context, workspaceID, ticketID, commentID string) error {
	c, ok := f.comments[commentID]
	if !ok || c.WorkspaceID != workspaceID || c.TicketID != ticketID || c.DeletedAt != nil {
		return repository.ErrTicketCommentNotFound
	}
	now := time.Now()
	c.DeletedAt = &now
	return nil
}

func (f *ticketFakeRepo) InsertTicketCommentEdit(_ context.Context, e *domain.TicketCommentEdit) error {
	e.ID = f.newID("edit")
	e.EditedAt = time.Now()
	f.commentEdits[e.CommentID] = append(f.commentEdits[e.CommentID], *e)
	return nil
}

func (f *ticketFakeRepo) ListTicketCommentEdits(_ context.Context, workspaceID, commentID string) ([]domain.TicketCommentEdit, error) {
	edits := f.commentEdits[commentID]
	out := make([]domain.TicketCommentEdit, len(edits))
	copy(out, edits)
	sort.Slice(out, func(i, j int) bool { return out[i].EditedAt.After(out[j].EditedAt) })
	return out, nil
}

func (f *ticketFakeRepo) AddTicketCommentReaction(_ context.Context, workspaceID, commentID string, userID uint64, emoji string) error {
	for _, r := range f.commentReactions[commentID] {
		if r.UserID == userID && r.Emoji == emoji {
			return nil // 冪等
		}
	}
	f.commentReactions[commentID] = append(f.commentReactions[commentID], domain.TicketCommentReaction{
		CommentID: commentID, UserID: userID, Emoji: emoji, CreatedAt: time.Now(),
	})
	return nil
}

func (f *ticketFakeRepo) RemoveTicketCommentReaction(_ context.Context, workspaceID, commentID string, userID uint64, emoji string) error {
	kept := f.commentReactions[commentID][:0]
	for _, r := range f.commentReactions[commentID] {
		if r.UserID == userID && r.Emoji == emoji {
			continue
		}
		kept = append(kept, r)
	}
	f.commentReactions[commentID] = kept
	return nil
}

func (f *ticketFakeRepo) ListTicketCommentReactions(_ context.Context, workspaceID string, commentIDs []string) ([]domain.TicketCommentReaction, error) {
	var out []domain.TicketCommentReaction
	for _, id := range commentIDs {
		out = append(out, f.commentReactions[id]...)
	}
	return out, nil
}

var _ repository.TicketCommentRepository = (*ticketFakeRepo)(nil)

// --- ラベル（語彙はワークスペース単位） ---

func (f *ticketFakeRepo) CreateLabel(_ context.Context, l *domain.Label) error {
	for _, other := range f.labels {
		if other.WorkspaceID == l.WorkspaceID &&
			strings.EqualFold(strings.TrimSpace(other.Name), strings.TrimSpace(l.Name)) {
			return repository.ErrLabelNameTaken
		}
	}
	l.ID = f.newID("label")
	l.CreatedAt = time.Now()
	l.UpdatedAt = l.CreatedAt
	stored := *l
	f.labels[l.ID] = &stored
	return nil
}

func (f *ticketFakeRepo) FindLabel(_ context.Context, workspaceID, labelID string) (*domain.Label, error) {
	l, ok := f.labels[labelID]
	if !ok || l.WorkspaceID != workspaceID {
		return nil, repository.ErrLabelNotFound
	}
	cp := *l
	return &cp, nil
}

func (f *ticketFakeRepo) ListLabels(_ context.Context, workspaceID string) ([]domain.Label, error) {
	var out []domain.Label
	for _, l := range f.labels {
		if l.WorkspaceID == workspaceID {
			out = append(out, *l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *ticketFakeRepo) UpdateLabel(_ context.Context, l *domain.Label) error {
	existing, ok := f.labels[l.ID]
	if !ok || existing.WorkspaceID != l.WorkspaceID {
		return repository.ErrLabelNotFound
	}
	for _, other := range f.labels {
		if other.ID != l.ID && other.WorkspaceID == l.WorkspaceID &&
			strings.EqualFold(strings.TrimSpace(other.Name), strings.TrimSpace(l.Name)) {
			return repository.ErrLabelNameTaken
		}
	}
	l.CreatedAt = existing.CreatedAt
	l.UpdatedAt = time.Now()
	stored := *l
	f.labels[l.ID] = &stored
	return nil
}

func (f *ticketFakeRepo) DeleteLabel(_ context.Context, workspaceID, labelID string) error {
	l, ok := f.labels[labelID]
	if !ok || l.WorkspaceID != workspaceID {
		return repository.ErrLabelNotFound
	}
	delete(f.labels, labelID)
	for tID, ids := range f.ticketLabels {
		kept := ids[:0]
		for _, id := range ids {
			if id != labelID {
				kept = append(kept, id)
			}
		}
		f.ticketLabels[tID] = kept
	}
	return nil
}

func (f *ticketFakeRepo) AddTicketLabel(_ context.Context, workspaceID, ticketID, labelID string) error {
	if _, ok := f.labels[labelID]; !ok {
		return repository.ErrLabelNotFound
	}
	for _, id := range f.ticketLabels[ticketID] {
		if id == labelID {
			return nil // 冪等
		}
	}
	f.ticketLabels[ticketID] = append(f.ticketLabels[ticketID], labelID)
	return nil
}

func (f *ticketFakeRepo) RemoveTicketLabel(_ context.Context, workspaceID, ticketID, labelID string) error {
	kept := f.ticketLabels[ticketID][:0]
	for _, id := range f.ticketLabels[ticketID] {
		if id != labelID {
			kept = append(kept, id)
		}
	}
	f.ticketLabels[ticketID] = kept
	return nil
}

func (f *ticketFakeRepo) ListLabelsByTicket(_ context.Context, workspaceID, ticketID string) ([]domain.Label, error) {
	var out []domain.Label
	for _, id := range f.ticketLabels[ticketID] {
		if l, ok := f.labels[id]; ok {
			out = append(out, *l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *ticketFakeRepo) ListLabelsByTicketIDs(_ context.Context, workspaceID string, ticketIDs []string) (map[string][]domain.Label, error) {
	out := map[string][]domain.Label{}
	for _, tID := range ticketIDs {
		var labels []domain.Label
		for _, id := range f.ticketLabels[tID] {
			if l, ok := f.labels[id]; ok {
				labels = append(labels, *l)
			}
		}
		if len(labels) > 0 {
			sort.Slice(labels, func(i, j int) bool { return labels[i].Name < labels[j].Name })
			out[tID] = labels
		}
	}
	return out, nil
}

func (f *ticketFakeRepo) AddPageLabel(_ context.Context, workspaceID, pageID, labelID string) error {
	if _, ok := f.labels[labelID]; !ok {
		return repository.ErrLabelNotFound
	}
	for _, id := range f.pageLabels[pageID] {
		if id == labelID {
			return nil // 冪等
		}
	}
	f.pageLabels[pageID] = append(f.pageLabels[pageID], labelID)
	return nil
}

func (f *ticketFakeRepo) RemovePageLabel(_ context.Context, workspaceID, pageID, labelID string) error {
	kept := f.pageLabels[pageID][:0]
	for _, id := range f.pageLabels[pageID] {
		if id != labelID {
			kept = append(kept, id)
		}
	}
	f.pageLabels[pageID] = kept
	return nil
}

func (f *ticketFakeRepo) ListLabelsByPage(_ context.Context, workspaceID, pageID string) ([]domain.Label, error) {
	var out []domain.Label
	for _, id := range f.pageLabels[pageID] {
		if l, ok := f.labels[id]; ok {
			out = append(out, *l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *ticketFakeRepo) ListLabelsByPageIDs(_ context.Context, workspaceID string, pageIDs []string) (map[string][]domain.Label, error) {
	out := map[string][]domain.Label{}
	for _, pID := range pageIDs {
		var labels []domain.Label
		for _, id := range f.pageLabels[pID] {
			if l, ok := f.labels[id]; ok {
				labels = append(labels, *l)
			}
		}
		if len(labels) > 0 {
			sort.Slice(labels, func(i, j int) bool { return labels[i].Name < labels[j].Name })
			out[pID] = labels
		}
	}
	return out, nil
}

var _ repository.LabelRepository = (*ticketFakeRepo)(nil)

// --- 段 4: 添付 ---

func (f *ticketFakeRepo) CreateTicketAttachment(_ context.Context, a *domain.TicketAttachment) error {
	a.ID = f.newID("attachment")
	a.CreatedAt = time.Now()
	stored := *a
	f.attachments[a.ID] = &stored
	return nil
}

func (f *ticketFakeRepo) FindTicketAttachment(_ context.Context, workspaceID, ticketID, attachmentID string) (*domain.TicketAttachment, error) {
	a, ok := f.attachments[attachmentID]
	if !ok || a.WorkspaceID != workspaceID || a.TicketID != ticketID {
		return nil, repository.ErrTicketAttachmentNotFound
	}
	cp := *a
	return &cp, nil
}

func (f *ticketFakeRepo) ListTicketAttachments(_ context.Context, workspaceID, ticketID string) ([]domain.TicketAttachment, error) {
	var out []domain.TicketAttachment
	for _, a := range f.attachments {
		if a.WorkspaceID == workspaceID && a.TicketID == ticketID {
			out = append(out, *a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (f *ticketFakeRepo) DeleteTicketAttachment(_ context.Context, workspaceID, ticketID, attachmentID string) error {
	a, ok := f.attachments[attachmentID]
	if !ok || a.WorkspaceID != workspaceID || a.TicketID != ticketID {
		return repository.ErrTicketAttachmentNotFound
	}
	delete(f.attachments, attachmentID)
	return nil
}

var _ repository.TicketAttachmentRepository = (*ticketFakeRepo)(nil)

// ticketAttachmentFakePresigner は TicketAttachmentPresigner の in-memory fake
// （実際の署名は行わず、key を埋め込んだだけの決定的な URL を返す）。
type ticketAttachmentFakePresigner struct{}

func (ticketAttachmentFakePresigner) PresignUpload(_ context.Context, key, _ string, _ int64) (string, int, error) {
	return "https://fake-storage.example/" + key + "?mode=put", 600, nil
}

func (ticketAttachmentFakePresigner) PresignDownload(_ context.Context, key string) (string, int, error) {
	return "https://fake-storage.example/" + key + "?mode=get", 600, nil
}

var _ repository.TicketAttachmentPresigner = ticketAttachmentFakePresigner{}

// --- 利用者が保存した絞り込み（repository.TicketSavedFilterRepository も同じ struct に実装する） ---

var _ repository.TicketSavedFilterRepository = (*ticketFakeRepo)(nil)

// addSavedFilter はテストの下ごしらえ用（他人の分を置く等。採番・一意性検査を経由しない直接投入）。
func (f *ticketFakeRepo) addSavedFilter(sf domain.TicketSavedFilter) *domain.TicketSavedFilter {
	stored := sf
	f.savedFilters[sf.ID] = &stored
	return &stored
}

// savedFilterRefsExist は本番の複合 FK の代わり（状態・種別は同じプロジェクト、ラベルは同じ
// ワークスペースに実在すること）。担当の主体は kbFakePerms 側にあってここからは見えないので
// 確かめない。
func (f *ticketFakeRepo) savedFilterRefsExist(sf *domain.TicketSavedFilter) error {
	if sf.StatusID != nil {
		s, ok := f.statuses[*sf.StatusID]
		if !ok || s.WorkspaceID != sf.WorkspaceID || s.ProjectID != sf.ProjectID {
			return repository.ErrTicketStatusNotFound
		}
	}
	if sf.TypeID != nil {
		ty, ok := f.types[*sf.TypeID]
		if !ok || ty.WorkspaceID != sf.WorkspaceID || ty.ProjectID != sf.ProjectID {
			return repository.ErrTicketTypeNotFound
		}
	}
	if sf.LabelID != nil {
		l, ok := f.labels[*sf.LabelID]
		if !ok || l.WorkspaceID != sf.WorkspaceID {
			return repository.ErrLabelNotFound
		}
	}
	return nil
}

// savedFilterNameTaken は uq_ticket_saved_filters_owner_name の代わり（同じ本人・同じプロジェクトで
// 大文字小文字を区別しない同名）。
func (f *ticketFakeRepo) savedFilterNameTaken(sf *domain.TicketSavedFilter) bool {
	for _, other := range f.savedFilters {
		if other.ID != sf.ID && other.ProjectID == sf.ProjectID && other.UserID == sf.UserID &&
			strings.EqualFold(other.Name, sf.Name) {
			return true
		}
	}
	return false
}

func (f *ticketFakeRepo) findOwnSavedFilter(workspaceID, projectID string, userID uint64, filterID string) (*domain.TicketSavedFilter, bool) {
	sf, ok := f.savedFilters[filterID]
	if !ok || sf.WorkspaceID != workspaceID || sf.ProjectID != projectID || sf.UserID != userID {
		return nil, false
	}
	return sf, true
}

func (f *ticketFakeRepo) InsertTicketSavedFilter(_ context.Context, sf *domain.TicketSavedFilter) error {
	if f.savedFilterNameTaken(sf) {
		return repository.ErrTicketSavedFilterNameTaken
	}
	if err := f.savedFilterRefsExist(sf); err != nil {
		return err
	}
	sf.ID = f.newID("filter")
	sf.CreatedAt, sf.UpdatedAt = time.Now(), time.Now()
	stored := *sf
	f.savedFilters[sf.ID] = &stored
	return nil
}

func (f *ticketFakeRepo) UpdateTicketSavedFilter(_ context.Context, sf *domain.TicketSavedFilter) error {
	stored, ok := f.findOwnSavedFilter(sf.WorkspaceID, sf.ProjectID, sf.UserID, sf.ID)
	if !ok {
		return repository.ErrTicketSavedFilterNotFound
	}
	if f.savedFilterNameTaken(sf) {
		return repository.ErrTicketSavedFilterNameTaken
	}
	if err := f.savedFilterRefsExist(sf); err != nil {
		return err
	}
	sf.CreatedAt = stored.CreatedAt
	sf.UpdatedAt = time.Now()
	*stored = *sf
	return nil
}

func (f *ticketFakeRepo) DeleteTicketSavedFilter(_ context.Context, workspaceID, projectID string, userID uint64, filterID string) error {
	if _, ok := f.findOwnSavedFilter(workspaceID, projectID, userID, filterID); !ok {
		return repository.ErrTicketSavedFilterNotFound
	}
	delete(f.savedFilters, filterID)
	return nil
}

func (f *ticketFakeRepo) ListTicketSavedFilters(_ context.Context, workspaceID, projectID string, userID uint64) ([]domain.TicketSavedFilter, error) {
	out := []domain.TicketSavedFilter{}
	for _, sf := range f.savedFilters {
		if sf.WorkspaceID == workspaceID && sf.ProjectID == projectID && sf.UserID == userID {
			out = append(out, *sf)
		}
	}
	// 本番の ORDER BY created_at, id と同じ並び（fake の ID は採番順なので ID で足りる）。
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (f *ticketFakeRepo) CountTicketSavedFilters(ctx context.Context, workspaceID, projectID string, userID uint64) (int64, error) {
	list, err := f.ListTicketSavedFilters(ctx, workspaceID, projectID, userID)
	if err != nil {
		return 0, err
	}
	return int64(len(list)), nil
}

// CountTickets は本番と同じく ListTickets と同じ条件で数える（fake では一覧を取って数えるだけ）。
func (f *ticketFakeRepo) CountTickets(ctx context.Context, in repository.ListTicketsInput) (int64, error) {
	list, err := f.ListTickets(ctx, in)
	if err != nil {
		return 0, err
	}
	return int64(list.Total), nil
}
