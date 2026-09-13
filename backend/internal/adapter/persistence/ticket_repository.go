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
		SpaceID:     row.SpaceID.String(),
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
		SpaceID:        row.SpaceID.String(),
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

func toDomainTicket(row sqlcgen.Ticket) domain.Ticket {
	t := domain.Ticket{
		ID:              row.ID.String(),
		WorkspaceID:     row.WorkspaceID.String(),
		SpaceID:         row.SpaceID.String(),
		Number:          row.Number,
		TypeID:          row.TypeID.String(),
		StatusID:        row.StatusID.String(),
		Title:           row.Title,
		Doc:             row.Doc,
		PlainText:       row.PlainText,
		Priority:        domain.TicketPriority(row.Priority),
		Position:        row.Position,
		CreatedByUserID: uint64(row.CreatedByUserID),
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
	if row.ParentID.Valid {
		id := row.ParentID.UUID.String()
		t.ParentID = &id
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

func (r *ticketRepository) HasActiveInitialTicketStatus(ctx context.Context, workspaceID, spaceID string) (bool, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return false, nil
	}
	return r.queries(ctx).HasActiveInitialTicketStatus(ctx, sqlcgen.HasActiveInitialTicketStatusParams{
		WorkspaceID: wsID, SpaceID: spID,
	})
}

func (r *ticketRepository) InsertTicketStatus(ctx context.Context, s *domain.TicketStatus) error {
	wsID, ok := kbParseID(s.WorkspaceID)
	spID, ok2 := kbParseID(s.SpaceID)
	if !ok || !ok2 {
		return repository.ErrSpaceNotFound
	}
	id, err := ticketNewID()
	if err != nil {
		return err
	}
	row, err := r.queries(ctx).InsertTicketStatus(ctx, sqlcgen.InsertTicketStatusParams{
		ID: id, WorkspaceID: wsID, SpaceID: spID,
		Name: s.Name, Category: string(s.Category), Color: s.Color,
		Position: s.Position, IsInitial: s.IsInitial,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketStatusNameTaken
		}
		if isForeignKeyViolation(err) {
			return repository.ErrSpaceNotFound
		}
		return err
	}
	*s = toDomainTicketStatus(row)
	return nil
}

func (r *ticketRepository) FindTicketStatus(ctx context.Context, workspaceID, spaceID, statusID string) (*domain.TicketStatus, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTicketStatusNotFound
	}
	row, err := r.queries(ctx).GetTicketStatus(ctx, sqlcgen.GetTicketStatusParams{
		WorkspaceID: wsID, SpaceID: spID, ID: stID,
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

func (r *ticketRepository) ListTicketStatuses(ctx context.Context, workspaceID, spaceID string, includeArchived bool) ([]domain.TicketStatus, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketStatuses(ctx, sqlcgen.ListTicketStatusesParams{
		WorkspaceID: wsID, SpaceID: spID, Archived: includeArchived,
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

func (r *ticketRepository) GetInitialTicketStatus(ctx context.Context, workspaceID, spaceID string) (*domain.TicketStatus, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return nil, repository.ErrTicketStatusNotFound
	}
	row, err := r.queries(ctx).GetInitialTicketStatus(ctx, sqlcgen.GetInitialTicketStatusParams{
		WorkspaceID: wsID, SpaceID: spID,
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
	spID, ok2 := kbParseID(s.SpaceID)
	stID, ok3 := kbParseID(s.ID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	row, err := r.queries(ctx).UpdateTicketStatus(ctx, sqlcgen.UpdateTicketStatusParams{
		WorkspaceID: wsID, SpaceID: spID, ID: stID,
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

func (r *ticketRepository) SetTicketStatusInitial(ctx context.Context, workspaceID, spaceID, statusID string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	// 旧初期状態を先に倒してから新しい状態を立てる（部分 UNIQUE のため同時に 2 つは
	// 作れない）。呼び出し側（usecase）が同一トランザクションで両方の repository 呼び出しを
	// くるむ想定だが、ここでも 2 文の順序自体はこの関数が保証する。
	if _, err := r.queries(ctx).ClearTicketStatusInitial(ctx, sqlcgen.ClearTicketStatusInitialParams{
		WorkspaceID: wsID, SpaceID: spID,
	}); err != nil {
		return err
	}
	n, err := r.queries(ctx).SetTicketStatusInitial(ctx, sqlcgen.SetTicketStatusInitialParams{
		WorkspaceID: wsID, SpaceID: spID, ID: stID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketStatusNotFound
	}
	return nil
}

func (r *ticketRepository) ArchiveTicketStatus(ctx context.Context, workspaceID, spaceID, statusID string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	n, err := r.queries(ctx).ArchiveTicketStatus(ctx, sqlcgen.ArchiveTicketStatusParams{
		WorkspaceID: wsID, SpaceID: spID, ID: stID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketStatusNotFound
	}
	return nil
}

func (r *ticketRepository) RestoreTicketStatus(ctx context.Context, workspaceID, spaceID, statusID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketStatusNotFound
	}
	n, err := r.queries(ctx).RestoreTicketStatus(ctx, sqlcgen.RestoreTicketStatusParams{
		WorkspaceID: wsID, SpaceID: spID, ID: stID, Position: position,
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

func (r *ticketRepository) CountActiveTicketsByStatus(ctx context.Context, workspaceID, spaceID, statusID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	stID, ok3 := kbParseID(statusID)
	if !ok || !ok2 || !ok3 {
		return 0, nil
	}
	return r.queries(ctx).CountActiveTicketsByStatus(ctx, sqlcgen.CountActiveTicketsByStatusParams{
		WorkspaceID: wsID, SpaceID: spID, StatusID: stID,
	})
}

func (r *ticketRepository) CountActiveTicketsByStatusForSpace(ctx context.Context, workspaceID, spaceID string) (map[string]int64, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return map[string]int64{}, nil
	}
	rows, err := r.queries(ctx).CountActiveTicketsGroupedByStatus(ctx, sqlcgen.CountActiveTicketsGroupedByStatusParams{
		WorkspaceID: wsID, SpaceID: spID,
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

func (r *ticketRepository) CountActiveTicketsByTypeForSpace(ctx context.Context, workspaceID, spaceID string) (map[string]int64, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return map[string]int64{}, nil
	}
	rows, err := r.queries(ctx).CountActiveTicketsGroupedByType(ctx, sqlcgen.CountActiveTicketsGroupedByTypeParams{
		WorkspaceID: wsID, SpaceID: spID,
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

func (r *ticketRepository) LastActiveTicketStatusPosition(ctx context.Context, workspaceID, spaceID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return "", nil
	}
	return r.queries(ctx).LastActiveTicketStatusPosition(ctx, sqlcgen.LastActiveTicketStatusPositionParams{
		WorkspaceID: wsID, SpaceID: spID,
	})
}

// --- ticket_types ---

func (r *ticketRepository) InsertTicketType(ctx context.Context, t *domain.TicketType) error {
	wsID, ok := kbParseID(t.WorkspaceID)
	spID, ok2 := kbParseID(t.SpaceID)
	if !ok || !ok2 {
		return repository.ErrSpaceNotFound
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
		ID: id, WorkspaceID: wsID, SpaceID: spID,
		Name: t.Name, Color: t.Color, HierarchyLevel: level,
		Position: t.Position, IsDefault: t.IsDefault,
		TemplateTitle: nullString(t.TemplateTitle), TemplateDoc: templateDoc,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrTicketTypeNameTaken
		}
		if isForeignKeyViolation(err) {
			return repository.ErrSpaceNotFound
		}
		return err
	}
	*t = toDomainTicketType(row)
	return nil
}

func (r *ticketRepository) FindTicketType(ctx context.Context, workspaceID, spaceID, typeID string) (*domain.TicketType, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrTicketTypeNotFound
	}
	row, err := r.queries(ctx).GetTicketType(ctx, sqlcgen.GetTicketTypeParams{
		WorkspaceID: wsID, SpaceID: spID, ID: tyID,
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

func (r *ticketRepository) ListTicketTypes(ctx context.Context, workspaceID, spaceID string, includeArchived bool) ([]domain.TicketType, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketTypes(ctx, sqlcgen.ListTicketTypesParams{
		WorkspaceID: wsID, SpaceID: spID, Archived: includeArchived,
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

func (r *ticketRepository) GetDefaultTicketType(ctx context.Context, workspaceID, spaceID string) (*domain.TicketType, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return nil, repository.ErrTicketTypeNotFound
	}
	row, err := r.queries(ctx).GetDefaultTicketType(ctx, sqlcgen.GetDefaultTicketTypeParams{
		WorkspaceID: wsID, SpaceID: spID,
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
	spID, ok2 := kbParseID(t.SpaceID)
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
		WorkspaceID: wsID, SpaceID: spID, ID: tyID,
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

func (r *ticketRepository) SetTicketTypeDefault(ctx context.Context, workspaceID, spaceID, typeID string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketTypeNotFound
	}
	if _, err := r.queries(ctx).ClearTicketTypeDefault(ctx, sqlcgen.ClearTicketTypeDefaultParams{
		WorkspaceID: wsID, SpaceID: spID,
	}); err != nil {
		return err
	}
	n, err := r.queries(ctx).SetTicketTypeDefault(ctx, sqlcgen.SetTicketTypeDefaultParams{
		WorkspaceID: wsID, SpaceID: spID, ID: tyID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketTypeNotFound
	}
	return nil
}

func (r *ticketRepository) ArchiveTicketType(ctx context.Context, workspaceID, spaceID, typeID string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketTypeNotFound
	}
	n, err := r.queries(ctx).ArchiveTicketType(ctx, sqlcgen.ArchiveTicketTypeParams{
		WorkspaceID: wsID, SpaceID: spID, ID: tyID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrTicketTypeNotFound
	}
	return nil
}

func (r *ticketRepository) RestoreTicketType(ctx context.Context, workspaceID, spaceID, typeID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrTicketTypeNotFound
	}
	n, err := r.queries(ctx).RestoreTicketType(ctx, sqlcgen.RestoreTicketTypeParams{
		WorkspaceID: wsID, SpaceID: spID, ID: tyID, Position: position,
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

func (r *ticketRepository) CountActiveTicketsByType(ctx context.Context, workspaceID, spaceID, typeID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	tyID, ok3 := kbParseID(typeID)
	if !ok || !ok2 || !ok3 {
		return 0, nil
	}
	return r.queries(ctx).CountActiveTicketsByType(ctx, sqlcgen.CountActiveTicketsByTypeParams{
		WorkspaceID: wsID, SpaceID: spID, TypeID: tyID,
	})
}

func (r *ticketRepository) LastActiveTicketTypePosition(ctx context.Context, workspaceID, spaceID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return "", nil
	}
	return r.queries(ctx).LastActiveTicketTypePosition(ctx, sqlcgen.LastActiveTicketTypePositionParams{
		WorkspaceID: wsID, SpaceID: spID,
	})
}

// --- tickets 本体 ---

func (r *ticketRepository) CreateTicket(ctx context.Context, in repository.TicketCreateInput) (*domain.Ticket, error) {
	wsID, ok := kbParseID(in.WorkspaceID)
	spID, ok2 := kbParseID(in.SpaceID)
	tyID, ok3 := kbParseID(in.TypeID)
	stID, ok4 := kbParseID(in.StatusID)
	if !ok || !ok2 || !ok3 || !ok4 {
		return nil, repository.ErrSpaceNotFound
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
		ID: id, WorkspaceID: wsID, SpaceID: spID,
		TypeID: tyID, StatusID: stID, ParentID: parentID,
		Title: in.Title, Doc: in.Doc, PlainText: in.PlainText,
		Priority:        priority,
		StartDate:       nullDate(in.StartDate),
		DueDate:         nullDate(in.DueDate),
		Position:        in.Position,
		CreatedByUserID: createdBy,
	})
	if err != nil {
		// created_by_user_id への FK は space/type/status/parent への FK とは意味が違う（入力の
		// user が居ない、であって「スペースが無い」ではない）ため、名前を見て振り分ける。
		if constraint, ok := foreignKeyViolationConstraint(err); ok {
			if constraint == "fk_tickets_created_by" {
				return nil, repository.ErrUserNotFound
			}
			return nil, repository.ErrSpaceNotFound
		}
		return nil, err
	}
	t := toDomainTicket(row)
	return &t, nil
}

// GetTicket / ListTickets / ListTicketChildren は担当・並び順を JOIN で足すため、sqlc は
// tickets の行型ではなく専用の行型を生成する。tickets 由来の列だけを取り出して既存の
// toDomainTicket に渡すための写し取り（変換規則は 1 箇所に保つ）。
//
// Position には row.Position（tickets.position、段 2 で正本ではなくなった古い列）ではなく
// row.RankPosition（ticket_ranks.position、段 2 からの正本）を積む。API 応答の position の
// 意味は変わらず、中身の出どころが変わっただけ。
func ticketOfGetRow(row sqlcgen.GetTicketRow) sqlcgen.Ticket {
	return sqlcgen.Ticket{
		ID: row.ID, WorkspaceID: row.WorkspaceID, SpaceID: row.SpaceID, Number: row.Number,
		TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
		Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority,
		StartDate: row.StartDate, DueDate: row.DueDate, Position: row.RankPosition,
		ClosedAt: row.ClosedAt, Resolution: row.Resolution,
		CreatedByUserID: row.CreatedByUserID, ArchivedAt: row.ArchivedAt, DeletedAt: row.DeletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func ticketOfListRow(row sqlcgen.ListTicketsRow) sqlcgen.Ticket {
	return sqlcgen.Ticket{
		ID: row.ID, WorkspaceID: row.WorkspaceID, SpaceID: row.SpaceID, Number: row.Number,
		TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
		Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority,
		StartDate: row.StartDate, DueDate: row.DueDate, Position: row.RankPosition,
		ClosedAt: row.ClosedAt, Resolution: row.Resolution,
		CreatedByUserID: row.CreatedByUserID, ArchivedAt: row.ArchivedAt, DeletedAt: row.DeletedAt,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func ticketOfChildrenRow(row sqlcgen.ListTicketChildrenRow) sqlcgen.Ticket {
	return sqlcgen.Ticket{
		ID: row.ID, WorkspaceID: row.WorkspaceID, SpaceID: row.SpaceID, Number: row.Number,
		TypeID: row.TypeID, StatusID: row.StatusID, ParentID: row.ParentID, Title: row.Title,
		Doc: row.Doc, PlainText: row.PlainText, Priority: row.Priority,
		StartDate: row.StartDate, DueDate: row.DueDate, Position: row.RankPosition,
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
		Ticket:              toDomainTicket(ticketOfGetRow(row)),
		AssigneePrincipalID: nullUUIDString(row.AssigneePrincipalID),
	}, nil
}

// GetTicketForUpdate（sqlc 生成、SELECT … FOR UPDATE）はまだどの usecase からも呼んでいない。
// ChangeTicketStatus / ChangeTicketParent 等の「読んでから書く」操作は現状ロックなしで、真に
// 同時に来た更新どうしの間で行自体は壊れないが（最後の書き込みが勝つ）、履歴の old→new の
// 並びが実際の順序とずれ得る（親変更の周期検出は複数チケットにまたがるため単一行ロックでは
// 防げず、スペース単位のアドバイザリロック等より大きい仕組みが要る）。クエリは残し、既知の
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

func (r *ticketRepository) ResolveTicketIDByKey(ctx context.Context, workspaceID, spaceKey string, number int64) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return "", repository.ErrTicketNotFound
	}
	row, err := r.queries(ctx).ResolveTicketIDByKey(ctx, sqlcgen.ResolveTicketIDByKeyParams{
		WorkspaceID: wsID, SpaceKey: spaceKey, Number: number,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", repository.ErrTicketNotFound
	}
	if err != nil {
		return "", err
	}
	return row.ID.String(), nil
}

func (r *ticketRepository) ListTickets(ctx context.Context, in repository.ListTicketsInput) ([]repository.TicketWithAssignee, error) {
	wsID, ok := kbParseID(in.WorkspaceID)
	spID, ok2 := kbParseID(in.SpaceID)
	if !ok || !ok2 {
		return nil, nil
	}
	statusID, ok3 := kbNullID(in.StatusID)
	typeID, ok4 := kbNullID(in.TypeID)
	assigneeID, ok5 := kbNullID(in.AssigneePrincipalID)
	labelID, ok6 := kbNullID(in.LabelID)
	assignedToMeID, ok7 := kbNullID(in.AssignedToMePrincipalID)
	if !ok3 || !ok4 || !ok5 || !ok6 || !ok7 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTickets(ctx, sqlcgen.ListTicketsParams{
		WorkspaceID: wsID, SpaceID: spID, IncludeArchived: in.IncludeArchived,
		StatusID: statusID, TypeID: typeID, AssigneePrincipalID: assigneeID,
		Unassigned: in.Unassigned, AssignedToMePrincipalID: assignedToMeID,
		LabelID: labelID, DueBefore: nullDate(in.DueBefore), StartAfter: nullDate(in.StartAfter),
		Overdue: in.Overdue, Q: nullString(in.Q),
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.TicketWithAssignee, 0, len(rows))
	for _, row := range rows {
		out = append(out, repository.TicketWithAssignee{
			Ticket:              toDomainTicket(ticketOfListRow(row)),
			AssigneePrincipalID: nullUUIDString(row.AssigneePrincipalID),
		})
	}
	return out, nil
}

func (r *ticketRepository) GetTicketCounts(
	ctx context.Context, workspaceID, spaceID string, myPrincipalID *string,
) (repository.TicketCounts, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return repository.TicketCounts{}, nil
	}
	myID, ok3 := kbNullID(myPrincipalID)
	if !ok3 {
		return repository.TicketCounts{}, nil
	}
	row, err := r.queries(ctx).GetTicketCounts(ctx, sqlcgen.GetTicketCountsParams{
		WorkspaceID: wsID, SpaceID: spID, MyPrincipalID: myID,
	})
	if err != nil {
		return repository.TicketCounts{}, err
	}
	return repository.TicketCounts{
		Total: row.Total, AssignedToMe: row.AssignedToMe, Overdue: row.Overdue, Unassigned: row.Unassigned,
	}, nil
}

func (r *ticketRepository) ListTicketChildren(ctx context.Context, workspaceID, spaceID, parentID string) ([]domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	pID, ok3 := kbParseID(parentID)
	if !ok || !ok2 || !ok3 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketChildren(ctx, sqlcgen.ListTicketChildrenParams{
		WorkspaceID: wsID, SpaceID: spID, ParentID: uuid.NullUUID{UUID: pID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Ticket, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicket(ticketOfChildrenRow(row)))
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
	row, err := r.queries(ctx).UpdateTicket(ctx, sqlcgen.UpdateTicketParams{
		WorkspaceID: wsID, ID: tID, TypeID: tyID, ParentID: parentID,
		Title: fields.Title, Doc: fields.Doc, PlainText: fields.PlainText,
		Priority:  priority,
		StartDate: nullDate(fields.StartDate),
		DueDate:   nullDate(fields.DueDate),
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
	t := toDomainTicket(row)
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
	t := toDomainTicket(row)
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

func (r *ticketRepository) RestoreTicket(ctx context.Context, workspaceID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	n, err := r.queries(ctx).RestoreTicket(ctx, sqlcgen.RestoreTicketParams{
		WorkspaceID: wsID, ID: tID, Position: position,
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
	t := toDomainTicket(row)
	return &t, nil
}

func (r *ticketRepository) RestoreDeletedTicket(ctx context.Context, workspaceID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotDeleted
	}
	n, err := r.queries(ctx).RestoreDeletedTicket(ctx, sqlcgen.RestoreDeletedTicketParams{
		WorkspaceID: wsID, ID: tID, Position: position,
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

// --- 並び順（ticket_ranks。段 2） ---

func (r *ticketRepository) InsertTicketRank(ctx context.Context, workspaceID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	return r.queries(ctx).InsertTicketRank(ctx, sqlcgen.InsertTicketRankParams{
		WorkspaceID: wsID, TicketID: tID, Position: position,
	})
}

func (r *ticketRepository) MoveTicketRank(ctx context.Context, workspaceID, ticketID, position string) error {
	wsID, ok := kbParseID(workspaceID)
	tID, ok2 := kbParseID(ticketID)
	if !ok || !ok2 {
		return repository.ErrTicketNotFound
	}
	n, err := r.queries(ctx).MoveTicketRank(ctx, sqlcgen.MoveTicketRankParams{
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

func (r *ticketRepository) LastActiveTicketRankPosition(ctx context.Context, workspaceID, spaceID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return "", repository.ErrSpaceNotFound
	}
	return r.queries(ctx).LastActiveTicketRankPosition(ctx, sqlcgen.LastActiveTicketRankPositionParams{
		WorkspaceID: wsID, SpaceID: spID,
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
		out = append(out, toDomainTicket(sqlcgen.Ticket(row)))
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
		out = append(out, toDomainTicket(row))
	}
	return out, nil
}

func (r *ticketRepository) LastActiveTicketPosition(ctx context.Context, workspaceID, spaceID string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return "", nil
	}
	return r.queries(ctx).LastActiveTicketPosition(ctx, sqlcgen.LastActiveTicketPositionParams{
		WorkspaceID: wsID, SpaceID: spID,
	})
}

func (r *ticketRepository) FindActiveTicketPosition(ctx context.Context, workspaceID, spaceID, ticketID string) (string, bool, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	tID, ok3 := kbParseID(ticketID)
	if !ok || !ok2 || !ok3 {
		return "", false, nil
	}
	pos, err := r.queries(ctx).FindActiveTicketPosition(ctx, sqlcgen.FindActiveTicketPositionParams{
		WorkspaceID: wsID, SpaceID: spID, ID: tID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return pos, true, nil
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
		out = append(out, toDomainTicket(row))
	}
	return out, nil
}

// --- 変更履歴 ---

func (r *ticketRepository) InsertTicketStatusTransition(
	ctx context.Context, workspaceID, spaceID, ticketID, fromStatusID, toStatusID string, changedByUserID uint64,
) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
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
		ID: id, WorkspaceID: wsID, SpaceID: spID, TicketID: tID,
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
func (r *ticketRepository) ListTicketsReferencingPage(ctx context.Context, workspaceID, pageID string) ([]domain.Ticket, error) {
	wsID, ok := kbParseID(workspaceID)
	pID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, nil
	}
	rows, err := r.queries(ctx).ListTicketsReferencingPage(ctx, sqlcgen.ListTicketsReferencingPageParams{
		WorkspaceID: wsID, TargetPageID: pID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.Ticket, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainTicket(row))
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
