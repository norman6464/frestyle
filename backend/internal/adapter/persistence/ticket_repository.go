package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/pgtext"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// nullDate は *string（'YYYY-MM-DD'）を pgtext.NullDate へ変換する（tickets.start_date /
// due_date の書き込み専用。読み取り側は pgtext.NullDate を直接 Scan する）。
func nullDate(s *string) pgtext.NullDate {
	if s == nil {
		return pgtext.NullDate{}
	}
	return pgtext.NullDate{String: *s, Valid: true}
}

// ticketRepository は [repository.TicketRepository] の実装。knowledgeBaseRepository と同じ作法
// （sqlc 生成コード + 素の *sql.DB、複数書き込みは baseRepository.dbtx 経由で TxManager.DoInTx に
// 相乗りする）。
type ticketRepository struct {
	baseRepository
}

func NewTicketRepository(db *sql.DB) repository.TicketRepository {
	return &ticketRepository{baseRepository{db: db}}
}

func (r *ticketRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

// ticketNewID は UUIDv7 を採番する（knowledgeBaseRepository.kbNewID と同じ理由）。
func ticketNewID() (uuid.UUID, error) {
	return kbNewID()
}

// errOutOfRangeInt32 は domain 側の int を DB の integer（int32）へ渡す直前の範囲外検出。
var errOutOfRangeInt32 = errors.New("value out of int32 range")

// toInt32 は int を int32 へ範囲チェック付きで変換する（comment_repository.go の nullInt32 と
// 同じ理由。Go の int は 64bit 前提）。HierarchyLevel・Priority は domain 側の値集合的に実際は
// 落ちないが、「あり得ないから確認しない」は採らない — 静かに折り返すと別の値が DB に入り、
// 原因が追えなくなる。
func toInt32(n int) (int32, bool) {
	if n < math.MinInt32 || n > math.MaxInt32 {
		return 0, false
	}
	return int32(n), true
}

func outOfRangeInt32Error(field string, n int) error {
	return fmt.Errorf("%w: %s=%d", errOutOfRangeInt32, field, n)
}

// --- 変換 ---

func toDomainTicketStatus(row sqlcgen.TicketStatus) domain.TicketStatus {
	s := domain.TicketStatus{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		ProjectID:   row.ProjectID.String(),
		Name:        row.Name,
		Category:    domain.TicketStatusCategory(row.Category),
		Color:       row.Color,
		Position:    row.Position,
		IsInitial:   row.IsInitial,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
	if row.ArchivedAt.Valid {
		t := row.ArchivedAt.Time
		s.ArchivedAt = &t
	}
	return s
}

func toDomainTicketType(row sqlcgen.TicketType) domain.TicketType {
	t := domain.TicketType{
		ID:             row.ID.String(),
		WorkspaceID:    row.WorkspaceID.String(),
		ProjectID:      row.ProjectID.String(),
		Name:           row.Name,
		Color:          row.Color,
		HierarchyLevel: int(row.HierarchyLevel),
		Position:       row.Position,
		IsDefault:      row.IsDefault,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.TemplateTitle.Valid {
		s := row.TemplateTitle.String
		t.TemplateTitle = &s
	}
	if row.TemplateDoc != nil {
		t.TemplateDoc = *row.TemplateDoc
	}
	if row.ArchivedAt.Valid {
		at := row.ArchivedAt.Time
		t.ArchivedAt = &at
	}
	return t
}

// toDomainTicket は tickets の行を domain.Ticket へ写す。
//
// 並び順（Position）は行から取れない —— tickets.position は撤去され、正本は
// ticket_backlog_ranks だけになった。そこで呼び出し側が rankPosition を渡す。
//
// 並び順を JOIN で引いている経路（GetTicket / ListTickets / ListTicketChildren）は
// その値を渡す。渡さない（空文字の）経路は次の 2 種類で、どちらも「並び順に意味が無い」:
//
//   - 並びではなく系統を返す一覧（祖先・親チェーン・参照元・担当者の担当一覧）
//   - 書き換えの応答（UpdateTicket / ChangeTicketStatus / FindDeletedTicket）。
//     更新は並び順に触らないが、RETURNING に JOIN を足すと sqlc の生成が通らない
//     （queries/ticket.sql の UpdateTicket の doc 参照）。並びが要る画面は一覧を読み直す。
//
// 空文字を「先頭」と解釈して並べ替えに使ってはいけない。並べ替えは DB 側の
// ORDER BY ticket_backlog_ranks.position が唯一の拠り所。
func toDomainTicket(row sqlcgen.Ticket, rankPosition string) domain.Ticket {
	t := domain.Ticket{
		ID:              row.ID.String(),
		WorkspaceID:     row.WorkspaceID.String(),
		ProjectID:       row.ProjectID.String(),
		Number:          row.Number,
		TypeID:          row.TypeID.String(),
		StatusID:        row.StatusID.String(),
		Title:           row.Title,
		Doc:             row.Doc,
		PlainText:       row.PlainText,
		Priority:        domain.TicketPriority(row.Priority),
		StoryPoints:     fromNullInt32(row.StoryPoints),
		Position:        rankPosition,
		CreatedByUserID: uint64(row.CreatedByUserID),
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
	if row.ParentID.Valid {
		id := row.ParentID.UUID.String()
		t.ParentID = &id
	}
	if row.TeamID.Valid {
		id := row.TeamID.UUID.String()
		t.TeamID = &id
	}
	if row.StartDate.Valid {
		s := row.StartDate.String
		t.StartDate = &s
	}
	if row.DueDate.Valid {
		s := row.DueDate.String
		t.DueDate = &s
	}
	if row.ClosedAt.Valid {
		at := row.ClosedAt.Time
		t.ClosedAt = &at
	}
	if row.Resolution.Valid {
		res := domain.TicketResolution(row.Resolution.String)
		t.Resolution = &res
	}
	if row.ArchivedAt.Valid {
		at := row.ArchivedAt.Time
		t.ArchivedAt = &at
	}
	if row.DeletedAt.Valid {
		at := row.DeletedAt.Time
		t.DeletedAt = &at
	}
	return t
}

func toDomainTicketAssignment(row sqlcgen.TicketAssignment) domain.TicketAssignment {
	return domain.TicketAssignment{
		WorkspaceID:         row.WorkspaceID.String(),
		TicketID:            row.TicketID.String(),
		AssigneePrincipalID: row.AssigneePrincipalID.String(),
		AssignedByUserID:    uint64(row.AssignedByUserID),
		CreatedAt:           row.CreatedAt,
	}
}

func toDomainTicketChangeGroup(row sqlcgen.TicketChangeGroup) domain.TicketChangeGroup {
	return domain.TicketChangeGroup{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		TicketID:    row.TicketID.String(),
		ActorUserID: uint64(row.ActorUserID),
		CreatedAt:   row.CreatedAt,
	}
}

func toDomainTicketChangeItem(row sqlcgen.TicketChangeItem) domain.TicketChangeItem {
	item := domain.TicketChangeItem{
		ID:      row.ID.String(),
		GroupID: row.GroupID.String(),
		Field:   domain.TicketChangeField(row.Field),
	}
	if row.OldValue.Valid {
		v := row.OldValue.String
		item.OldValue = &v
	}
	if row.NewValue.Valid {
		v := row.NewValue.String
		item.NewValue = &v
	}
	if row.OldLabel.Valid {
		v := row.OldLabel.String
		item.OldLabel = &v
	}
	if row.NewLabel.Valid {
		v := row.NewLabel.String
		item.NewLabel = &v
	}
	return item
}

// --- ticket_statuses ---

func (r *ticketRepository) HasActiveInitialTicketStatus(ctx context.Context, workspaceID, projectID string) (bool, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return false, nil
	}
	return r.queries(ctx).HasActiveInitialTicketStatus(ctx, sqlcgen.HasActiveInitialTicketStatusParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
}

func (r *ticketRepository) InsertTicketStatus(ctx context.Context, s *domain.TicketStatus) error {
	wsID, ok := kbParseID(s.WorkspaceID)
	pjID, ok2 := kbParseID(s.ProjectID)
	if !ok || !ok2 {
		return repository.ErrProjectNotFound
	}
	id, err := ticketNewID()
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).InsertTicketStatus(ctx, sqlcgen.InsertTicketStatusParams{
		ID: id, WorkspaceID: wsID, ProjectID: pjID,
		Name: s.Name, Category: string(s.Category), Color: s.Color,
		Position: s.Position, IsInitial: s.IsInitial,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketStatusNameTaken
		}
		if isForeignKeyViolation(err) {
			return repository.ErrProjectNotFound
		}
		return err
	}
	*s = toDomainTicketStatus(row)
	return nil
}

func (r *ticketRepository) FindTicketStatus(ctx context.Context, workspaceID, projectID, statusID string) (*domain.TicketStatus, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTicketStatusNotFound
	}
	row, err := r.queries(ctx).GetTicketStatus(ctx, sqlcgen.GetTicketStatusParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: stID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketStatusNotFound
	}
	if err != nil {
		return nil, err
	}
	s := toDomainTicketStatus(row)
	return &s, nil
}

func (r *ticketRepository) ListTicketStatuses(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketStatus, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketStatuses(ctx, sqlcgen.ListTicketStatusesParams{
		WorkspaceID: wsID, ProjectID: pjID, Archived: includeArchived,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.TicketStatus, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicketStatus(row))
	}
	return out, nil
}

func (r *ticketRepository) GetInitialTicketStatus(ctx context.Context, workspaceID, projectID string) (*domain.TicketStatus, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, repository.ErrTicketStatusNotFound
	}
	row, err := r.queries(ctx).GetInitialTicketStatus(ctx, sqlcgen.GetInitialTicketStatusParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketStatusNotFound
	}
	if err != nil {
		return nil, err
	}
	s := toDomainTicketStatus(row)
	return &s, nil
}

func (r *ticketRepository) UpdateTicketStatus(ctx context.Context, s *domain.TicketStatus) error {
	wsID, ok := kbParseID(s.WorkspaceID)
	pjID, ok2 := kbParseID(s.ProjectID)
	stID, ok3 := kbParseID(s.ID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	row, err := r.queries(ctx).UpdateTicketStatus(ctx, sqlcgen.UpdateTicketStatusParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: stID,
		Name: s.Name, Category: string(s.Category), Color: s.Color,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return repository.ErrTicketStatusNotFound
	}
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketStatusNameTaken
		}
		return err
	}
	*s = toDomainTicketStatus(row)
	return nil
}

func (r *ticketRepository) SetTicketStatusInitial(ctx context.Context, workspaceID, projectID, statusID string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	// 旧初期状態を先に倒してから新しい状態を立てる（部分 UNIQUE のため同時に 2 つは
	// 作れない）。呼び出し側（usecase）が同一トランザクションで両方の repository 呼び出しを
	// くるむ想定だが、ここでも 2 文の順序自体はこの関数が保証する。
	if _, err := r.queries(ctx).ClearTicketStatusInitial(ctx, sqlcgen.ClearTicketStatusInitialParams{
		WorkspaceID: wsID, ProjectID: pjID,
	}); err != nil {
		return err
	}
	n, err := r.queries(ctx).SetTicketStatusInitial(ctx, sqlcgen.SetTicketStatusInitialParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: stID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketStatusNotFound
	}
	return nil
}

func (r *ticketRepository) ArchiveTicketStatus(ctx context.Context, workspaceID, projectID, statusID string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	n, err := r.queries(ctx).ArchiveTicketStatus(ctx, sqlcgen.ArchiveTicketStatusParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: stID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketStatusNotFound
	}
	return nil
}

func (r *ticketRepository) RestoreTicketStatus(ctx context.Context, workspaceID, projectID, statusID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	n, err := r.queries(ctx).RestoreTicketStatus(ctx, sqlcgen.RestoreTicketStatusParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: stID, Position: position,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketStatusNameTaken
		}
		return err
	}
	if n == 0 {
		return repository.ErrTicketStatusNotFound
	}
	return nil
}

func (r *ticketRepository) CountActiveTicketsByStatus(ctx context.Context, workspaceID, projectID, statusID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return 0, nil
	}
	return r.queries(ctx).CountActiveTicketsByStatus(ctx, sqlcgen.CountActiveTicketsByStatusParams{
		WorkspaceID: wsID, ProjectID: pjID, StatusID: stID,
	})
}

func (r *ticketRepository) CountActiveTicketsByStatusForProject(ctx context.Context, workspaceID, projectID string) (map[string]int64, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return map[string]int64{}, nil
	}
	rows, err := r.queries(ctx).CountActiveTicketsGroupedByStatus(ctx, sqlcgen.CountActiveTicketsGroupedByStatusParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, row := range rows {
		out[row.StatusID.String()] = row.Count
	}
	return out, nil
}

func (r *ticketRepository) CountActiveTicketsByTypeForProject(ctx context.Context, workspaceID, projectID string) (map[string]int64, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return map[string]int64{}, nil
	}
	rows, err := r.queries(ctx).CountActiveTicketsGroupedByType(ctx, sqlcgen.CountActiveTicketsGroupedByTypeParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string]int64, len(rows))
	for _, row := range rows {
		out[row.TypeID.String()] = row.Count
	}
	return out, nil
}

func (r *ticketRepository) LastActiveTicketStatusPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return "", nil
	}
	return r.queries(ctx).LastActiveTicketStatusPosition(ctx, sqlcgen.LastActiveTicketStatusPositionParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
}

// --- ticket_types ---

func (r *ticketRepository) InsertTicketType(ctx context.Context, t *domain.TicketType) error {
	wsID, ok := kbParseID(t.WorkspaceID)
	pjID, ok2 := kbParseID(t.ProjectID)
	if !ok || !ok2 {
		return repository.ErrProjectNotFound
	}
	id, err := ticketNewID()
	if err != nil {
		return err
	}
	var templateDoc *json.RawMessage
	if t.TemplateDoc != nil {
		templateDoc = &t.TemplateDoc
	}
	level, okLevel := toInt32(t.HierarchyLevel)
	if !okLevel {
		return outOfRangeInt32Error("hierarchy_level", t.HierarchyLevel)
	}
	row, err := r.queries(ctx).InsertTicketType(ctx, sqlcgen.InsertTicketTypeParams{
		ID: id, WorkspaceID: wsID, ProjectID: pjID,
		Name: t.Name, Color: t.Color, HierarchyLevel: level,
		Position: t.Position, IsDefault: t.IsDefault,
		TemplateTitle: nullString(t.TemplateTitle), TemplateDoc: templateDoc,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketTypeNameTaken
		}
		if isForeignKeyViolation(err) {
			return repository.ErrProjectNotFound
		}
		return err
	}
	*t = toDomainTicketType(row)
	return nil
}

func (r *ticketRepository) FindTicketType(ctx context.Context, workspaceID, projectID, typeID string) (*domain.TicketType, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTicketTypeNotFound
	}
	row, err := r.queries(ctx).GetTicketType(ctx, sqlcgen.GetTicketTypeParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: tyID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketTypeNotFound
	}
	if err != nil {
		return nil, err
	}
	t := toDomainTicketType(row)
	return &t, nil
}

func (r *ticketRepository) ListTicketTypes(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketType, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketTypes(ctx, sqlcgen.ListTicketTypesParams{
		WorkspaceID: wsID, ProjectID: pjID, Archived: includeArchived,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.TicketType, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicketType(row))
	}
	return out, nil
}

func (r *ticketRepository) GetDefaultTicketType(ctx context.Context, workspaceID, projectID string) (*domain.TicketType, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return nil, repository.ErrTicketTypeNotFound
	}
	row, err := r.queries(ctx).GetDefaultTicketType(ctx, sqlcgen.GetDefaultTicketTypeParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketTypeNotFound
	}
	if err != nil {
		return nil, err
	}
	t := toDomainTicketType(row)
	return &t, nil
}

func (r *ticketRepository) UpdateTicketType(ctx context.Context, t *domain.TicketType) error {
	wsID, ok := kbParseID(t.WorkspaceID)
	pjID, ok2 := kbParseID(t.ProjectID)
	tyID, ok3 := kbParseID(t.ID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketTypeNotFound
	}
	var templateDoc *json.RawMessage
	if t.TemplateDoc != nil {
		templateDoc = &t.TemplateDoc
	}
	level, okLevel := toInt32(t.HierarchyLevel)
	if !okLevel {
		return outOfRangeInt32Error("hierarchy_level", t.HierarchyLevel)
	}
	row, err := r.queries(ctx).UpdateTicketType(ctx, sqlcgen.UpdateTicketTypeParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: tyID,
		Name: t.Name, Color: t.Color, HierarchyLevel: level,
		TemplateTitle: nullString(t.TemplateTitle), TemplateDoc: templateDoc,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return repository.ErrTicketTypeNotFound
	}
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketTypeNameTaken
		}
		return err
	}
	*t = toDomainTicketType(row)
	return nil
}

func (r *ticketRepository) SetTicketTypeDefault(ctx context.Context, workspaceID, projectID, typeID string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketTypeNotFound
	}
	if _, err := r.queries(ctx).ClearTicketTypeDefault(ctx, sqlcgen.ClearTicketTypeDefaultParams{
		WorkspaceID: wsID, ProjectID: pjID,
	}); err != nil {
		return err
	}
	n, err := r.queries(ctx).SetTicketTypeDefault(ctx, sqlcgen.SetTicketTypeDefaultParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: tyID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketTypeNotFound
	}
	return nil
}

func (r *ticketRepository) ArchiveTicketType(ctx context.Context, workspaceID, projectID, typeID string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketTypeNotFound
	}
	n, err := r.queries(ctx).ArchiveTicketType(ctx, sqlcgen.ArchiveTicketTypeParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: tyID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketTypeNotFound
	}
	return nil
}

func (r *ticketRepository) RestoreTicketType(ctx context.Context, workspaceID, projectID, typeID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketTypeNotFound
	}
	n, err := r.queries(ctx).RestoreTicketType(ctx, sqlcgen.RestoreTicketTypeParams{
		WorkspaceID: wsID, ProjectID: pjID, ID: tyID, Position: position,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketTypeNameTaken
		}
		return err
	}
	if n == 0 {
		return repository.ErrTicketTypeNotFound
	}
	return nil
}

func (r *ticketRepository) CountActiveTicketsByType(ctx context.Context, workspaceID, projectID, typeID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return 0, nil
	}
	return r.queries(ctx).CountActiveTicketsByType(ctx, sqlcgen.CountActiveTicketsByTypeParams{
		WorkspaceID: wsID, ProjectID: pjID, TypeID: tyID,
	})
}

func (r *ticketRepository) LastActiveTicketTypePosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return "", nil
	}
	return r.queries(ctx).LastActiveTicketTypePosition(ctx, sqlcgen.LastActiveTicketTypePositionParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
}

// --- tickets 本体 ---

func (r *ticketRepository) CreateTicket(ctx context.Context, in repository.TicketCreateInput) (*domain.Ticket, error) {
	wsID, ok := kbParseID(in.WorkspaceID)
	pjID, ok2 := kbParseID(in.ProjectID)
	tyID, ok3 := kbParseID(in.TypeID)
	stID, ok4 := kbParseID(in.StatusID)
	if !ok || !ok2 || !ok3 || !ok4 {
		return nil, repository.ErrProjectNotFound
	}
	parentID, ok5 := kbNullID(in.ParentID)
	if !ok5 {
		return nil, repository.ErrTicketNotFound
	}
	id, err := ticketNewID()
	if err != nil {
		return nil, err
	}
	priority, okPriority := toInt32(int(in.Priority))
	if !okPriority {
		return nil, outOfRangeInt32Error("priority", int(in.Priority))
	}
	createdBy, okCreatedBy := toInt64ID(in.CreatedByUserID)
	if !okCreatedBy {
		return nil, outOfRangeIDError("created_by_user_id", in.CreatedByUserID)
	}
	row, err := r.queries(ctx).CreateTicket(ctx, sqlcgen.CreateTicketParams{
		ID: id, WorkspaceID: wsID, ProjectID: pjID,
		TypeID: tyID, StatusID: stID, ParentID: parentID,
		Title: in.Title, Doc: in.Doc, PlainText: in.PlainText,
		Priority:        priority,
		StartDate:       nullDate(in.StartDate),
		DueDate:         nullDate(in.DueDate),
		CreatedByUserID: createdBy,
	})
	if err != nil {
		// created_by_user_id への FK は space/type/status/parent への FK とは意味が違う（入力の
		// user が居ない、であって「プロジェクトが無い」ではない）ため、名前を見て振り分ける。
		if constraint, ok := foreignKeyViolationConstraint(err); ok {
			if constraint == "fk_tickets_created_by" {
				return nil, repository.ErrUserNotFound
			}
			return nil, repository.ErrProjectNotFound
		}
		return nil, err
	}
	t := toDomainTicket(row, "")
	return &t, nil
}

// GetTicket / ListTickets / ListTicketChildren は担当・並び順を JOIN で足すため、sqlc は
// tickets の行型ではなく専用の行型を生成する。tickets 由来の列だけを取り出して既存の
// toDomainTicket に渡すための写し取り（変換規則は 1 箇所に保つ）。
//
// 並び順は sqlcgen.Ticket には入らない（tickets に列が無い）。呼び出し側が
// row.RankPosition を toDomainTicket の第 2 引数へ渡す。
func ticketOfGetRow(row sqlcgen.GetTicketRow) sqlcgen.Ticket {
	return sqlcgen.Ticket{
		ID: row.ID, WorkspaceID: row.WorkspaceID, ProjectID: row.ProjectID, Number: row.Number,
		TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
		Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority,
		StoryPoints: row.StoryPoints, TeamID: row.TeamID,
		StartDate: row.StartDate, DueDate: row.DueDate,
		ClosedAt: row.ClosedAt, Resolution: row.Resolution,
		CreatedByUserID: row.CreatedByUserID, ArchivedAt: row.ArchivedAt, DeletedAt: row.DeletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func ticketOfListRow(row sqlcgen.ListTicketsRow) sqlcgen.Ticket {
	return sqlcgen.Ticket{
		ID: row.ID, WorkspaceID: row.WorkspaceID, ProjectID: row.ProjectID, Number: row.Number,
		TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
		Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority,
		StoryPoints: row.StoryPoints, TeamID: row.TeamID,
		StartDate: row.StartDate, DueDate: row.DueDate,
		ClosedAt: row.ClosedAt, Resolution: row.Resolution,
		CreatedByUserID: row.CreatedByUserID, ArchivedAt: row.ArchivedAt, DeletedAt: row.DeletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

// ticketOfParentChainRow は親チェーンの行を Ticket へ写す。space_id を選ばなくなったので
// 素の型変換ではなく列ごとに詰める（ticketOfListRow と同じ形）。
func ticketOfParentChainRow(row sqlcgen.ListTicketParentChainRow) sqlcgen.Ticket {
	// 親チェーンはパンくず用で、見積り・担当チームは選んでいない（行型にも無い）。
	return sqlcgen.Ticket{
		ID: row.ID, WorkspaceID: row.WorkspaceID, ProjectID: row.ProjectID, Number: row.Number,
		TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
		Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority,
		StartDate: row.StartDate, DueDate: row.DueDate,
		ClosedAt: row.ClosedAt, Resolution: row.Resolution,
		CreatedByUserID: row.CreatedByUserID, ArchivedAt: row.ArchivedAt, DeletedAt: row.DeletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func ticketOfChildrenRow(row sqlcgen.ListTicketChildrenRow) sqlcgen.Ticket {
	return sqlcgen.Ticket{
		ID: row.ID, WorkspaceID: row.WorkspaceID, ProjectID: row.ProjectID, Number: row.Number,
		TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
		Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority,
		StoryPoints: row.StoryPoints, TeamID: row.TeamID,
		StartDate: row.StartDate, DueDate: row.DueDate,
		ClosedAt: row.ClosedAt, Resolution: row.Resolution,
		CreatedByUserID: row.CreatedByUserID, ArchivedAt: row.ArchivedAt, DeletedAt: row.DeletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

// nullUUIDString は uuid.NullUUID を *string へ畳む（NULL は nil）。
func nullUUIDString(v uuid.NullUUID) *string {
	if !v.Valid {
		return nil
	}
	s := v.UUID.String()
	return &s
}

func (r *ticketRepository) FindTicket(ctx context.Context, workspaceID, ticketID string) (*domain.Ticket, error) {
	found, err := r.FindTicketWithAssignee(ctx, workspaceID, ticketID)
	if err != nil {
		return nil, err
	}
	t := found.Ticket
	return &t, nil
}

func (r *ticketRepository) FindTicketWithAssignee(ctx context.Context, workspaceID, ticketID string) (*repository.TicketWithAssignee, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, repository.ErrTicketNotFound
	}
	row, err := r.queries(ctx).GetTicket(ctx, sqlcgen.GetTicketParams{WorkspaceID: wsID, ID: tID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}
	return &repository.TicketWithAssignee{
		Ticket:              toDomainTicket(ticketOfGetRow(row), row.RankPosition),
		AssigneePrincipalID: nullUUIDString(row.AssigneePrincipalID),
	}, nil
}

// GetTicketForUpdate（sqlc 生成、SELECT … FOR UPDATE）はまだどの usecase からも呼んでいない。
// ChangeTicketStatus / ChangeTicketParent 等の「読んでから書く」操作は現状ロックなしで、真に
// 同時に来た更新どうしの間で行自体は壊れないが（最後の書き込みが勝つ）、履歴の old→new の
// 並びが実際の順序とずれ得る（親変更の周期検出は複数チケットにまたがるため単一行ロックでは
// 防げず、プロジェクト単位のアドバイザリロック等より大きい仕組みが要る）。クエリは残し、既知の
// ギャップとして後続で配線する。

// FindTicketWorkspaceID はチケットを ID だけで引く（詳細は port のコメント）。
func (r *ticketRepository) FindTicketWorkspaceID(ctx context.Context, ticketID string) (string, error) {
	tID, ok := kbParseID(ticketID)
	if !ok {
		return "", repository.ErrTicketNotFound
	}
	row, err := r.queries(ctx).GetTicketAcrossWorkspaces(ctx, tID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", repository.ErrTicketNotFound
	}
	if err != nil {
		return "", err
	}
	return row.WorkspaceID.String(), nil
}

func (r *ticketRepository) ResolveTicketIDByKey(ctx context.Context, workspaceID, projectKey string, number int64) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return "", repository.ErrTicketNotFound
	}
	row, err := r.queries(ctx).ResolveTicketIDByKey(ctx, sqlcgen.ResolveTicketIDByKeyParams{
		WorkspaceID: wsID, ProjectKey: projectKey, Number: number,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", repository.ErrTicketNotFound
	}
	if err != nil {
		return "", err
	}
	return row.ID.String(), nil
}

// ticketFilterParams は ListTicketsInput を sqlc の引数へ解く。ID の形が壊れていれば ok=false
// （ListTickets は空、CountTickets は 0 件として扱う —— 形の壊れた ID に合う行は無い）。
// ListTickets と CountTickets の WHERE は sqlc の都合で写し合っているが、Go 側の詰め替えは
// ここ 1 か所にまとめ、条件を足すときに片方だけ直してずれる余地を無くす。
func ticketFilterParams(in repository.ListTicketsInput) (sqlcgen.ListTicketsParams, bool) {
	wsID, ok := kbParseID(in.WorkspaceID)
	pjID, ok2 := kbParseID(in.ProjectID)
	statusID, ok3 := kbNullID(in.StatusID)
	typeID, ok4 := kbNullID(in.TypeID)
	assigneeID, ok5 := kbNullID(in.AssigneePrincipalID)
	labelID, ok6 := kbNullID(in.LabelID)
	assignedToMeID, ok7 := kbNullID(in.AssignedToMePrincipalID)
	if !ok || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 || !ok7 {
		return sqlcgen.ListTicketsParams{}, false
	}
	return sqlcgen.ListTicketsParams{
		WorkspaceID: wsID, ProjectID: pjID, IncludeArchived: in.IncludeArchived,
		StatusID: statusID, TypeID: typeID, AssigneePrincipalID: assigneeID,
		Unassigned: in.Unassigned, AssignedToMePrincipalID: assignedToMeID,
		LabelID: labelID, DueBefore: nullDate(in.DueBefore), StartAfter: nullDate(in.StartAfter),
		Overdue: in.Overdue, Q: nullString(in.Q),
	}, true
}

func (r *ticketRepository) ListTickets(ctx context.Context, in repository.ListTicketsInput) ([]repository.TicketWithAssignee, error) {
	params, ok := ticketFilterParams(in)
	if !ok {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTickets(ctx, params)
	if err != nil {
		return nil, err
	}
	out := make([]repository.TicketWithAssignee, 0, len(rows))
	for _, row := range rows {
		out = append(out, repository.TicketWithAssignee{
			Ticket:              toDomainTicket(ticketOfListRow(row), row.RankPosition),
			AssigneePrincipalID: nullUUIDString(row.AssigneePrincipalID),
		})
	}
	return out, nil
}

func (r *ticketRepository) CountTickets(ctx context.Context, in repository.ListTicketsInput) (int64, error) {
	params, ok := ticketFilterParams(in)
	if !ok {
		return 0, nil
	}
	// CountTicketsParams は ListTicketsParams と同じ引数を同じ順で持つ（WHERE が写しなので sqlc が
	// 同じ構造体を起こす）。型変換で詰め替えることで、片方にだけ引数が増えたらここがコンパイル
	// エラーになり、WHERE のずれに気づける。
	return r.queries(ctx).CountTickets(ctx, sqlcgen.CountTicketsParams(params))
}

func (r *ticketRepository) GetTicketCounts(
	ctx context.Context, workspaceID, projectID string, myPrincipalID *string,
) (repository.TicketCounts, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return repository.TicketCounts{}, nil
	}
	myID, ok3 := kbNullID(myPrincipalID)
	if !ok3 {
		return repository.TicketCounts{}, nil
	}
	row, err := r.queries(ctx).GetTicketCounts(ctx, sqlcgen.GetTicketCountsParams{
		WorkspaceID: wsID, ProjectID: pjID, MyPrincipalID: myID,
	})
	if err != nil {
		return repository.TicketCounts{}, err
	}
	return repository.TicketCounts{
		Total: row.Total, AssignedToMe: row.AssignedToMe, Overdue: row.Overdue, Unassigned: row.Unassigned,
	}, nil
}

func (r *ticketRepository) ListTicketChildren(ctx context.Context, workspaceID, projectID, parentID string) ([]domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	pID, ok3 := kbParseID(parentID)
	if !ok || !ok2 || !ok3 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketChildren(ctx, sqlcgen.ListTicketChildrenParams{
		WorkspaceID: wsID, ProjectID: pjID, ParentID: uuid.NullUUID{UUID: pID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Ticket, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicket(ticketOfChildrenRow(row), row.RankPosition))
	}
	return out, nil
}

func (r *ticketRepository) UpdateTicket(ctx context.Context, workspaceID, ticketID string, fields repository.TicketUpdateFields) (*domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	tyID, ok3 := kbParseID(fields.TypeID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTicketNotFound
	}
	parentID, ok4 := kbNullID(fields.ParentID)
	if !ok4 {
		return nil, repository.ErrTicketNotFound
	}
	priority, okPriority := toInt32(int(fields.Priority))
	if !okPriority {
		return nil, outOfRangeInt32Error("priority", int(fields.Priority))
	}
	// 未見積り（nil）と 0 を分けて運ぶ。列は integer だが渡すのは bigint —— int32 へ
	// 縮めて渡すと範囲外が黙って負数へ折り返すため、範囲の判定は PostgreSQL に任せる
	// （範囲外は "integer out of range"、1000 超は ck_tickets_story_points_range で落ちる）。
	storyPoints := nullInt64(fields.StoryPoints)
	row, err := r.queries(ctx).UpdateTicket(ctx, sqlcgen.UpdateTicketParams{
		WorkspaceID: wsID, ID: tID, TypeID: tyID, ParentID: parentID,
		Title: fields.Title, Doc: fields.Doc, PlainText: fields.PlainText,
		Priority:    priority,
		StoryPoints: storyPoints,
		StartDate:   nullDate(fields.StartDate),
		DueDate:     nullDate(fields.DueDate),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketNotFound
	}
	if err != nil {
		if isForeignKeyViolation(err) {
			return nil, repository.ErrTicketNotFound
		}
		return nil, err
	}
	t := toDomainTicket(row, "")
	return &t, nil
}

func (r *ticketRepository) ChangeTicketStatus(
	ctx context.Context, workspaceID, ticketID, statusID string,
	closedAt *time.Time, resolution *domain.TicketResolution,
) (*domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTicketNotFound
	}
	var closedAtNull sql.NullTime
	if closedAt != nil {
		closedAtNull = sql.NullTime{Time: *closedAt, Valid: true}
	}
	var resolutionNull sql.NullString
	if resolution != nil {
		resolutionNull = sql.NullString{String: string(*resolution), Valid: true}
	}
	row, err := r.queries(ctx).ChangeTicketStatus(ctx, sqlcgen.ChangeTicketStatusParams{
		WorkspaceID: wsID, ID: tID, StatusID: stID,
		ClosedAt: closedAtNull, Resolution: resolutionNull,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketNotFound
	}
	if err != nil {
		if isForeignKeyViolation(err) {
			return nil, repository.ErrTicketStatusNotFound
		}
		return nil, err
	}
	t := toDomainTicket(row, "")
	return &t, nil
}

func (r *ticketRepository) ArchiveTicket(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	n, err := r.queries(ctx).ArchiveTicket(ctx, sqlcgen.ArchiveTicketParams{WorkspaceID: wsID, ID: tID})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketNotFound
	}
	return nil
}

func (r *ticketRepository) RestoreTicket(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	n, err := r.queries(ctx).RestoreTicket(ctx, sqlcgen.RestoreTicketParams{
		WorkspaceID: wsID, ID: tID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketNotFound
	}
	return nil
}

func (r *ticketRepository) DeleteTicket(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	n, err := r.queries(ctx).DeleteTicket(ctx, sqlcgen.DeleteTicketParams{WorkspaceID: wsID, ID: tID})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketNotFound
	}
	return nil
}

func (r *ticketRepository) FindDeletedTicket(ctx context.Context, workspaceID, ticketID string) (*domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, repository.ErrTicketNotDeleted
	}
	row, err := r.queries(ctx).FindDeletedTicket(ctx, sqlcgen.FindDeletedTicketParams{WorkspaceID: wsID, ID: tID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrTicketNotDeleted
	}
	if err != nil {
		return nil, err
	}
	t := toDomainTicket(row, "")
	return &t, nil
}

func (r *ticketRepository) RestoreDeletedTicket(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotDeleted
	}
	n, err := r.queries(ctx).RestoreDeletedTicket(ctx, sqlcgen.RestoreDeletedTicketParams{
		WorkspaceID: wsID, ID: tID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketNotDeleted
	}
	return nil
}

func (r *ticketRepository) DeleteTicketPageLinksBySourceCascade(ctx context.Context, workspaceID, sourceTicketID string) error {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sourceTicketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).DeleteTicketPageLinksBySourceCascade(ctx, sqlcgen.DeleteTicketPageLinksBySourceCascadeParams{
		WorkspaceID: wsID, SourceTicketID: sID,
	})
}

func (r *ticketRepository) DeleteTicketTicketLinksBySourceCascade(ctx context.Context, workspaceID, sourceTicketID string) error {
	wsID, ok := kbParseID(workspaceID)
	sID, ok2 := kbParseID(sourceTicketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).DeleteTicketTicketLinksBySourceCascade(ctx, sqlcgen.DeleteTicketTicketLinksBySourceCascadeParams{
		WorkspaceID: wsID, SourceTicketID: sID,
	})
}

// --- 並び順（ticket_backlog_ranks） ---

func (r *ticketRepository) InsertTicketRank(ctx context.Context, workspaceID, projectID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(projectID)
	tID, ok3 := kbParseID(ticketID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).InsertTicketBacklogRank(ctx, sqlcgen.InsertTicketBacklogRankParams{
		WorkspaceID: wsID, ProjectID: pID, TicketID: tID, Position: position,
	})
}

func (r *ticketRepository) MoveTicketRank(ctx context.Context, workspaceID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	n, err := r.queries(ctx).MoveTicketBacklogRank(ctx, sqlcgen.MoveTicketBacklogRankParams{
		WorkspaceID: wsID, TicketID: tID, Position: position,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketNotFound
	}
	return nil
}

func (r *ticketRepository) LastTicketRankPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	if !ok || !ok2 {
		return "", repository.ErrProjectNotFound
	}
	return r.queries(ctx).LastTicketBacklogRankPosition(ctx, sqlcgen.LastTicketBacklogRankPositionParams{
		WorkspaceID: wsID, ProjectID: pjID,
	})
}

// UpsertTicketRank は復元で末尾へ置き直す。行が無いチケット（この表より前に作られ、
// 移行の時点でアーカイブ済み・削除済みだった分）にも効くよう upsert にしてある。
func (r *ticketRepository) UpsertTicketRank(ctx context.Context, workspaceID, projectID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(projectID)
	tID, ok3 := kbParseID(ticketID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).UpsertTicketBacklogRank(ctx, sqlcgen.UpsertTicketBacklogRankParams{
		WorkspaceID: wsID, ProjectID: pID, TicketID: tID, Position: position,
	})
}

func (r *ticketRepository) CountActiveTicketChildren(ctx context.Context, workspaceID, ticketID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return 0, nil
	}
	return r.queries(ctx).CountActiveTicketChildren(ctx, sqlcgen.CountActiveTicketChildrenParams{
		WorkspaceID: wsID, ParentID: uuid.NullUUID{UUID: tID, Valid: true},
	})
}

func (r *ticketRepository) ListTicketParentChain(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketParentChain(ctx, sqlcgen.ListTicketParentChainParams{
		WorkspaceID: wsID, TicketID: tID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Ticket, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicket(ticketOfParentChainRow(row), ""))
	}
	return out, nil
}

func (r *ticketRepository) InsertTicketPathSelf(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).InsertTicketPathSelf(ctx, sqlcgen.InsertTicketPathSelfParams{
		WorkspaceID: wsID, TicketID: tID,
	})
}

func (r *ticketRepository) InsertTicketPathAncestors(ctx context.Context, workspaceID, ticketID, parentID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	pID, ok3 := kbParseID(parentID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).InsertTicketPathAncestors(ctx, sqlcgen.InsertTicketPathAncestorsParams{
		TicketID: tID, WorkspaceID: wsID, ParentID: pID,
	})
}

func (r *ticketRepository) DetachTicketPathSubtree(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).DetachTicketPathSubtree(ctx, sqlcgen.DetachTicketPathSubtreeParams{
		WorkspaceID: wsID, TicketID: tID,
	})
}

func (r *ticketRepository) AttachTicketPathSubtree(ctx context.Context, workspaceID, ticketID, newParentID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	pID, ok3 := kbParseID(newParentID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).AttachTicketPathSubtree(ctx, sqlcgen.AttachTicketPathSubtreeParams{
		NewParentID: pID, WorkspaceID: wsID, TicketID: tID,
	})
}

func (r *ticketRepository) ListTicketAncestors(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketAncestors(ctx, sqlcgen.ListTicketAncestorsParams{
		WorkspaceID: wsID, TicketID: tID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Ticket, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicket(row, ""))
	}
	return out, nil
}

// --- ticket_assignments ---

func (r *ticketRepository) UpsertTicketAssignment(ctx context.Context, a *domain.TicketAssignment) error {
	wsID, ok := kbParseID(a.WorkspaceID)
	tID, ok2 := kbParseID(a.TicketID)
	pID, ok3 := kbParseID(a.AssigneePrincipalID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketNotFound
	}
	assignedBy, ok4 := toInt64ID(a.AssignedByUserID)
	if !ok4 {
		return outOfRangeIDError("assigned_by_user_id", a.AssignedByUserID)
	}
	row, err := r.queries(ctx).UpsertTicketAssignment(ctx, sqlcgen.UpsertTicketAssignmentParams{
		WorkspaceID: wsID, TicketID: tID, AssigneePrincipalID: pID,
		AssignedByUserID: assignedBy,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// WHERE ticket_assignments.workspace_id = EXCLUDED.workspace_id が不一致（ticket_id と
		// その実際の workspace_id の取り違え）。テナント越え書き込みの歯止めが働いた状態。
		return repository.ErrTicketNotFound
	}
	if err != nil {
		if constraint, ok := foreignKeyViolationConstraint(err); ok {
			// assigned_by_user_id への FK は「実行者が居ない」であって「担当者が居ない」
			// ではないので、他の FK とは分けて返す。
			if constraint == "fk_ticket_assignments_assigned_by" {
				return repository.ErrUserNotFound
			}
			// principal/ticket への FK 違反はここに畳む。呼び出し側は事前にチケットの実在を
			// 確かめるため、実務上ここに来るのはほぼ担当者側の違反になる。
			return repository.ErrTicketAssigneeNotFound
		}
		return err
	}
	*a = toDomainTicketAssignment(row)
	return nil
}

func (r *ticketRepository) DeleteTicketAssignment(ctx context.Context, workspaceID, ticketID string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil
	}
	_, err := r.queries(ctx).DeleteTicketAssignment(ctx, sqlcgen.DeleteTicketAssignmentParams{
		WorkspaceID: wsID, TicketID: tID,
	})
	return err
}

func (r *ticketRepository) FindTicketAssignment(ctx context.Context, workspaceID, ticketID string) (*domain.TicketAssignment, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, nil
	}
	row, err := r.queries(ctx).GetTicketAssignment(ctx, sqlcgen.GetTicketAssignmentParams{
		WorkspaceID: wsID, TicketID: tID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	a := toDomainTicketAssignment(row)
	return &a, nil
}

func (r *ticketRepository) ListTicketsAssignedToPrincipal(ctx context.Context, workspaceID, principalID string) ([]domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(principalID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketsAssignedToPrincipal(ctx, sqlcgen.ListTicketsAssignedToPrincipalParams{
		WorkspaceID: wsID, AssigneePrincipalID: pID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Ticket, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicket(row, ""))
	}
	return out, nil
}

func (r *ticketRepository) ListAssignedTickets(ctx context.Context, workspaceID, principalID string) ([]domain.AssignedTicket, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(principalID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListAssignedTicketsForPrincipal(ctx, sqlcgen.ListAssignedTicketsForPrincipalParams{
		WorkspaceID: wsID, AssigneePrincipalID: pID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.AssignedTicket, 0, len(rows))
	for _, row := range rows {
		// 生成された行型は tickets の全列に隣の表の値を足した別の型なので、tickets の部分だけを
		// sqlcgen.Ticket へ詰め直して既存の変換を通す（変換の規則を 2 か所に分けない）。
		out = append(out, domain.AssignedTicket{
			Ticket: toDomainTicket(sqlcgen.Ticket{
				ID: row.ID, WorkspaceID: row.WorkspaceID, ProjectID: row.ProjectID, Number: row.Number,
				TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
				Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority, StartDate: row.StartDate,
				DueDate: row.DueDate, ClosedAt: row.ClosedAt, Resolution: row.Resolution,
				CreatedByUserID: row.CreatedByUserID, ArchivedAt: row.ArchivedAt, DeletedAt: row.DeletedAt,
				CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			}, ""),
			ProjectKey:     row.ProjectKey,
			ProjectName:    row.ProjectName,
			StatusName:     row.StatusName,
			StatusCategory: domain.TicketStatusCategory(row.StatusCategory),
			StatusColor:    row.StatusColor,
			TypeName:       row.TypeName,
		})
	}
	return out, nil
}

func (r *ticketRepository) ListAssignedTicketsAcrossWorkspaces(
	ctx context.Context, userID uint64, workspaceIDs []string, limit int,
) ([]domain.AssignedTicketSummary, error) {
	out := []domain.AssignedTicketSummary{}
	// bigint に収まらない userID はどの principal にも一致しない ＝ 担当 0 件。
	uid, uok := toInt64ID(userID)
	if !uok || limit <= 0 {
		return out, nil
	}
	// 解釈できない ID は SQL の ::uuid で落ちるので、渡す前に外す（どのワークスペースにも
	// 一致しない値なので、外しても答えは変わらない）。
	ids := make([]string, 0, len(workspaceIDs))
	for _, id := range workspaceIDs {
		if parsed, ok := kbParseID(id); ok {
			ids = append(ids, parsed.String())
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	idsJSON, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	rowLimit, ok := toInt32(limit)
	if !ok {
		return nil, outOfRangeInt32Error("limit", limit)
	}
	rows, err := r.queries(ctx).ListAssignedTicketsAcrossWorkspaces(ctx, sqlcgen.ListAssignedTicketsAcrossWorkspacesParams{
		UserID:       sql.NullInt64{Int64: uid, Valid: true},
		WorkspaceIds: idsJSON,
		RowLimit:     rowLimit,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		t := domain.AssignedTicketSummary{
			ID:             row.ID.String(),
			WorkspaceSlug:  row.WorkspaceSlug,
			WorkspaceName:  row.WorkspaceName,
			ProjectID:      row.ProjectID.String(),
			ProjectKey:     row.ProjectKey,
			ProjectName:    row.ProjectName,
			Number:         row.Number,
			Title:          row.Title,
			Priority:       domain.TicketPriority(row.Priority),
			StatusName:     row.StatusName,
			StatusCategory: domain.TicketStatusCategory(row.StatusCategory),
			StatusColor:    row.StatusColor,
			TypeName:       row.TypeName,
			CreatedAt:      row.CreatedAt,
		}
		if row.DueDate.Valid {
			d := row.DueDate.String
			t.DueDate = &d
		}
		out = append(out, t)
	}
	return out, nil
}

// fromNullInt32 は列の NULL を nil に戻す。
// nullInt64 は *int を sql.NullInt64 へ畳む（nil は NULL）。int は 64bit なので取りこぼしは無い。
func nullInt64(v *int) sql.NullInt64 {
	if v == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*v), Valid: true}
}

func fromNullInt32(v sql.NullInt32) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int32)
	return &n
}

func (r *ticketRepository) AddTicketWatcher(ctx context.Context, workspaceID, ticketID string, userID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	// ticket_watchers.user_id は bigint。素の int64(userID) は math.MaxInt64 超で負数へ
	// 巻き戻り、入力とは無関係な行を指す（お気に入りと同じ扱いに揃える）。
	uid, ok3 := toInt64ID(userID)
	if !ok3 {
		return outOfRangeIDError("user_id", userID)
	}
	return r.queries(ctx).InsertTicketWatcher(ctx, sqlcgen.InsertTicketWatcherParams{
		WorkspaceID: wsID, TicketID: tID, UserID: uid,
	})
}

func (r *ticketRepository) RemoveTicketWatcher(ctx context.Context, workspaceID, ticketID string, userID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	uid, ok3 := toInt64ID(userID)
	if !ok3 {
		return outOfRangeIDError("user_id", userID)
	}
	// 監視していない人が押しても落とさない（結果はどちらも「監視していない」）。
	_, err := r.queries(ctx).DeleteTicketWatcher(ctx, sqlcgen.DeleteTicketWatcherParams{
		WorkspaceID: wsID, TicketID: tID, UserID: uid,
	})
	return err
}

func (r *ticketRepository) CountTicketWatchers(ctx context.Context, workspaceID, ticketID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return 0, nil
	}
	return r.queries(ctx).CountTicketWatchers(ctx, sqlcgen.CountTicketWatchersParams{WorkspaceID: wsID, TicketID: tID})
}

func (r *ticketRepository) IsTicketWatchedBy(ctx context.Context, workspaceID, ticketID string, userID uint64) (bool, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return false, nil
	}
	uid, ok3 := toInt64ID(userID)
	if !ok3 {
		return false, outOfRangeIDError("user_id", userID)
	}
	return r.queries(ctx).IsTicketWatchedBy(ctx, sqlcgen.IsTicketWatchedByParams{
		WorkspaceID: wsID, TicketID: tID, UserID: uid,
	})
}

// --- 変更履歴 ---

func (r *ticketRepository) InsertTicketStatusTransition(
	ctx context.Context, workspaceID, projectID, ticketID, fromStatusID, toStatusID string, changedByUserID uint64,
) error {
	wsID, ok := kbParseID(workspaceID)
	pjID, ok2 := kbParseID(projectID)
	tID, ok3 := kbParseID(ticketID)
	fromID, ok4 := kbParseID(fromStatusID)
	toID, ok5 := kbParseID(toStatusID)
	if !ok || !ok2 || !ok3 || !ok4 || !ok5 {
		return repository.ErrTicketNotFound
	}
	id, err := ticketNewID()
	if err != nil {
		return err
	}
	changedBy, okChangedBy := toInt64ID(changedByUserID)
	if !okChangedBy {
		return outOfRangeIDError("changed_by_user_id", changedByUserID)
	}
	if err := r.queries(ctx).InsertTicketStatusTransition(ctx, sqlcgen.InsertTicketStatusTransitionParams{
		ID: id, WorkspaceID: wsID, ProjectID: pjID, TicketID: tID,
		FromStatusID: fromID, ToStatusID: toID, ChangedByUserID: changedBy,
	}); err != nil {
		if constraint, ok := foreignKeyViolationConstraint(err); ok {
			// changed_by_user_id への FK は「実行者が居ない」であって「チケットが無い」ではない。
			if constraint == "fk_ticket_status_transitions_changed_by" {
				return repository.ErrUserNotFound
			}
			return repository.ErrTicketNotFound
		}
		return err
	}
	return nil
}

func (r *ticketRepository) InsertTicketChangeGroup(ctx context.Context, g *domain.TicketChangeGroup) error {
	wsID, ok := kbParseID(g.WorkspaceID)
	tID, ok2 := kbParseID(g.TicketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	id, err := ticketNewID()
	if err != nil {
		return err
	}
	actorID, okActor := toInt64ID(g.ActorUserID)
	if !okActor {
		return outOfRangeIDError("actor_user_id", g.ActorUserID)
	}
	row, err := r.queries(ctx).InsertTicketChangeGroup(ctx, sqlcgen.InsertTicketChangeGroupParams{
		ID: id, WorkspaceID: wsID, TicketID: tID, ActorUserID: actorID,
	})
	if err != nil {
		if constraint, ok := foreignKeyViolationConstraint(err); ok {
			// actor_user_id への FK は「実行者が居ない」であって「チケットが無い」ではない。
			if constraint == "fk_ticket_change_groups_actor" {
				return repository.ErrUserNotFound
			}
			return repository.ErrTicketNotFound
		}
		return err
	}
	// toDomainTicketChangeGroup は group 自体の列だけを組み立て Items は持たないため、
	// 代入前に呼び出し側の Items を退避しておかないと上書きで消えてしまう
	// （結合テストで ListTicketChangeGroups が items 0 件を返して発覚）。
	items := g.Items
	*g = toDomainTicketChangeGroup(row)
	g.Items = items
	return r.insertTicketChangeItems(ctx, wsID, g)
}

// insertTicketChangeItems は g.Items（呼び出し側が事前に詰めた項目）を group_id を埋めて
// 1 件ずつ挿入する。件数は「1 回の保存で変わった項目の数」で通常は数件のため、
// バルク insert の複雑さ（json 展開）は割に合わないと判断した。
func (r *ticketRepository) insertTicketChangeItems(ctx context.Context, wsID uuid.UUID, g *domain.TicketChangeGroup) error {
	groupID, ok := kbParseID(g.ID)
	if !ok {
		return repository.ErrTicketNotFound
	}
	for i := range g.Items {
		item := &g.Items[i]
		id, err := ticketNewID()
		if err != nil {
			return err
		}
		item.GroupID = g.ID
		item.ID = id.String()
		if err := r.queries(ctx).InsertTicketChangeItem(ctx, sqlcgen.InsertTicketChangeItemParams{
			ID: id, WorkspaceID: wsID, GroupID: groupID, Field: string(item.Field),
			OldValue: nullString(item.OldValue), NewValue: nullString(item.NewValue),
			OldLabel: nullString(item.OldLabel), NewLabel: nullString(item.NewLabel),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (r *ticketRepository) ListTicketChangeGroups(ctx context.Context, workspaceID, ticketID string) ([]domain.TicketChangeGroup, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return nil, nil
	}
	groupRows, err := r.queries(ctx).ListTicketChangeGroups(ctx, sqlcgen.ListTicketChangeGroupsParams{
		WorkspaceID: wsID, TicketID: tID,
	})
	if err != nil {
		return nil, err
	}
	groups := make([]domain.TicketChangeGroup, 0, len(groupRows))
	ids := make([]string, 0, len(groupRows))
	for _, row := range groupRows {
		groups = append(groups, toDomainTicketChangeGroup(row))
		ids = append(ids, row.ID.String())
	}
	if len(ids) == 0 {
		return groups, nil
	}
	idsJSON, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	itemRows, err := r.queries(ctx).ListTicketChangeItemsByGroupIDs(ctx, sqlcgen.ListTicketChangeItemsByGroupIDsParams{
		WorkspaceID: wsID, GroupIds: idsJSON,
	})
	if err != nil {
		return nil, err
	}
	byGroup := map[string][]domain.TicketChangeItem{}
	for _, row := range itemRows {
		gid := row.GroupID.String()
		byGroup[gid] = append(byGroup[gid], toDomainTicketChangeItem(row))
	}
	for i := range groups {
		groups[i].Items = byGroup[groups[i].ID]
	}
	return groups, nil
}

// --- 派生表 ---

func (r *ticketRepository) ReplaceTicketPageLinks(ctx context.Context, workspaceID, sourceTicketID string, targetPageIDs []string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(sourceTicketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	q := r.queries(ctx)
	if err := q.DeleteTicketPageLinksBySource(ctx, sqlcgen.DeleteTicketPageLinksBySourceParams{
		WorkspaceID: wsID, SourceTicketID: tID,
	}); err != nil {
		return err
	}
	if len(targetPageIDs) == 0 {
		return nil
	}
	existing, err := r.existingPageIDs(ctx, wsID, targetPageIDs)
	if err != nil {
		return err
	}
	for _, id := range existing {
		if err := q.InsertTicketPageLink(ctx, sqlcgen.InsertTicketPageLinkParams{
			WorkspaceID: wsID, SourceTicketID: tID, TargetPageID: id,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (r *ticketRepository) existingPageIDs(ctx context.Context, wsID uuid.UUID, candidates []string) ([]uuid.UUID, error) {
	idsJSON, err := json.Marshal(candidates)
	if err != nil {
		return nil, err
	}
	return r.queries(ctx).ListExistingPageIDsInWorkspace(ctx, sqlcgen.ListExistingPageIDsInWorkspaceParams{
		WorkspaceID: wsID, PageIds: idsJSON,
	})
}

func (r *ticketRepository) ReplaceTicketTicketLinks(ctx context.Context, workspaceID, sourceTicketID string, targetTicketIDs []string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(sourceTicketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	q := r.queries(ctx)
	if err := q.DeleteTicketTicketLinksBySource(ctx, sqlcgen.DeleteTicketTicketLinksBySourceParams{
		WorkspaceID: wsID, SourceTicketID: tID,
	}); err != nil {
		return err
	}
	// 自己参照は保存側の入口（usecase）でも弾くが、DB の ck_ticket_ticket_links_not_self にも
	// 守らせるため、ここでも候補から自分自身を除く（二重の防御のうち安価な方をここに置く）。
	filtered := make([]string, 0, len(targetTicketIDs))
	for _, id := range targetTicketIDs {
		if id != sourceTicketID {
			filtered = append(filtered, id)
		}
	}
	if len(filtered) == 0 {
		return nil
	}
	idsJSON, err := json.Marshal(filtered)
	if err != nil {
		return err
	}
	existing, err := q.ListExistingTicketIDsInWorkspace(ctx, sqlcgen.ListExistingTicketIDsInWorkspaceParams{
		WorkspaceID: wsID, TicketIds: idsJSON,
	})
	if err != nil {
		return err
	}
	for _, id := range existing {
		if err := q.InsertTicketTicketLink(ctx, sqlcgen.InsertTicketTicketLinkParams{
			WorkspaceID: wsID, SourceTicketID: tID, TargetTicketID: id,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (r *ticketRepository) ListTicketPageLinks(ctx context.Context, workspaceID, sourceTicketID string) ([]domain.TicketPageLink, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(sourceTicketID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketPageLinksBySource(ctx, sqlcgen.ListTicketPageLinksBySourceParams{
		WorkspaceID: wsID, SourceTicketID: tID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.TicketPageLink, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.TicketPageLink{
			WorkspaceID: row.WorkspaceID.String(), SourceTicketID: row.SourceTicketID.String(),
			TargetPageID: row.TargetPageID.String(),
		})
	}
	return out, nil
}

// ListTicketsReferencingPage はそのページを参照しているチケット一覧を返す（ページ詳細の
// 逆参照用）。target_page_id で絞る — source_ticket_id 絞り（自分が参照しているページ）とは
// 向きが逆なので混同しないこと。
func (r *ticketRepository) ListTicketsReferencingPage(
	ctx context.Context, workspaceID, pageID string, limit int,
) ([]domain.TicketReference, error) {
	out := []domain.TicketReference{}
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(pageID)
	if !ok || !ok2 || limit <= 0 {
		return out, nil
	}
	rowLimit, ok := toInt32(limit)
	if !ok {
		return nil, outOfRangeInt32Error("limit", limit)
	}
	rows, err := r.queries(ctx).ListTicketsReferencingPage(ctx, sqlcgen.ListTicketsReferencingPageParams{
		WorkspaceID: wsID, TargetPageID: pID, RowLimit: rowLimit,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out = append(out, domain.TicketReference{
			ID: row.ID.String(), ProjectKey: row.ProjectKey, Number: row.Number, Title: row.Title,
		})
	}
	return out, nil
}

func (r *ticketRepository) ListTicketTicketLinks(ctx context.Context, workspaceID, sourceTicketID string) ([]domain.TicketTicketLink, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(sourceTicketID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketTicketLinksBySource(ctx, sqlcgen.ListTicketTicketLinksBySourceParams{
		WorkspaceID: wsID, SourceTicketID: tID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.TicketTicketLink, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.TicketTicketLink{
			WorkspaceID: row.WorkspaceID.String(), SourceTicketID: row.SourceTicketID.String(),
			TargetTicketID: row.TargetTicketID.String(),
		})
	}
	return out, nil
}

func (r *ticketRepository) ListTicketsReferencingTicket(ctx context.Context, workspaceID, targetTicketID string) ([]domain.TicketTicketLink, error) {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(targetTicketID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketsReferencingTicket(ctx, sqlcgen.ListTicketsReferencingTicketParams{
		WorkspaceID: wsID, TargetTicketID: tID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.TicketTicketLink, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.TicketTicketLink{
			WorkspaceID: row.WorkspaceID.String(), SourceTicketID: row.SourceTicketID.String(),
			TargetTicketID: row.TargetTicketID.String(),
		})
	}
	return out, nil
}
