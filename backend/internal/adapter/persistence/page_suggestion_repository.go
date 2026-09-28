package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// pageSuggestionRepository は [repository.PageSuggestionRepository] の実装。page_suggestions は
// KnowledgeBaseRepository と同じくスキーマの正本が schema.hcl で GORM を通さない方針のため、
// クエリはすべて sqlc 生成コード + 素の *sql.DB で書く。
type pageSuggestionRepository struct {
	baseRepository
}

// NewPageSuggestionRepository は提案の repository を組み立てる。
func NewPageSuggestionRepository(db *sql.DB) repository.PageSuggestionRepository {
	return &pageSuggestionRepository{baseRepository{db: db}}
}

// queries は ctx に乗っているトランザクション（あれば）に束縛した sqlc の Queries を作る。
func (r *pageSuggestionRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

func toDomainPageSuggestion(row sqlcgen.PageSuggestion) domain.PageSuggestion {
	s := domain.PageSuggestion{
		ID:           row.ID.String(),
		WorkspaceID:  row.WorkspaceID.String(),
		PageID:       row.PageID.String(),
		Doc:          string(row.Doc),
		Status:       domain.PageSuggestionStatus(row.Status),
		AuthorUserID: uint64(row.AuthorUserID),
		CreatedAt:    row.CreatedAt,
	}
	if row.BaseSeq.Valid {
		seq := row.BaseSeq.Int64
		s.BaseSeq = &seq
	}
	if row.BaseRevision.Valid {
		revision := row.BaseRevision.Int64
		s.BaseRevision = &revision
	}
	if row.ResolvedAt.Valid {
		resolvedAt := row.ResolvedAt.Time
		s.ResolvedAt = &resolvedAt
	}
	if row.ResolvedByUserID.Valid {
		resolvedBy := uint64(row.ResolvedByUserID.Int64)
		s.ResolvedByUserID = &resolvedBy
	}
	return s
}

func (r *pageSuggestionRepository) Create(ctx context.Context, s *domain.PageSuggestion) error {
	wsID, ok := kbParseID(s.WorkspaceID)
	if !ok {
		return repository.ErrWorkspaceNotFound
	}
	pgID, ok := kbParseID(s.PageID)
	if !ok {
		return repository.ErrPageNotFound
	}
	id, err := kbNewID()
	if err != nil {
		return err
	}
	authorID, ok := toInt64ID(s.AuthorUserID)
	if !ok {
		return outOfRangeIDError("author_user_id", s.AuthorUserID)
	}
	var baseSeq sql.NullInt64
	if s.BaseSeq != nil {
		baseSeq = sql.NullInt64{Int64: *s.BaseSeq, Valid: true}
	}
	var baseRevision sql.NullInt64
	if s.BaseRevision != nil {
		baseRevision = sql.NullInt64{Int64: *s.BaseRevision, Valid: true}
	}
	row, err := r.queries(ctx).InsertPageSuggestion(ctx, sqlcgen.InsertPageSuggestionParams{
		ID:           id,
		WorkspaceID:  wsID,
		PageID:       pgID,
		BaseSeq:      baseSeq,
		BaseRevision: baseRevision,
		Doc:          json.RawMessage(s.Doc),
		AuthorUserID: authorID,
	})
	if err != nil {
		return err
	}
	*s = toDomainPageSuggestion(row)
	return nil
}

func (r *pageSuggestionRepository) ListOpen(ctx context.Context, workspaceID, pageID string, limit int) ([]domain.PageSuggestion, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return []domain.PageSuggestion{}, nil
	}
	// limit は usecase 側で上限（maxOpenSuggestionsLimit=200）まで挟んだ値が渡ってくるが、
	// ticket_repository.go の toInt32 と同じ理由で「あり得ないから確認しない」を採らず、
	// ここでも明示的に範囲チェックする（gosec G115 対応）。
	rowLimit, ok3 := toInt32(limit)
	if !ok3 {
		return nil, outOfRangeInt32Error("limit", limit)
	}
	rows, err := r.queries(ctx).ListOpenPageSuggestions(ctx, sqlcgen.ListOpenPageSuggestionsParams{
		WorkspaceID: wsID, PageID: pgID, RowLimit: rowLimit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.PageSuggestion, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainPageSuggestion(row))
	}
	return out, nil
}

func (r *pageSuggestionRepository) CountOpen(ctx context.Context, workspaceID, pageID string) (int, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return 0, nil
	}
	count, err := r.queries(ctx).CountOpenPageSuggestions(ctx, sqlcgen.CountOpenPageSuggestionsParams{
		WorkspaceID: wsID, PageID: pgID,
	})
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

func (r *pageSuggestionRepository) CountOpenByAuthor(ctx context.Context, workspaceID, pageID string, authorUserID uint64) (int, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return 0, nil
	}
	authorID, ok3 := toInt64ID(authorUserID)
	if !ok3 {
		// 表現できない ID は「そのユーザー本人の open 提案」が存在しようがないので 0 件。
		return 0, nil
	}
	count, err := r.queries(ctx).CountOpenPageSuggestionsByAuthor(ctx, sqlcgen.CountOpenPageSuggestionsByAuthorParams{
		WorkspaceID: wsID, PageID: pgID, AuthorUserID: authorID,
	})
	if err != nil {
		return 0, err
	}
	return int(count), nil
}

func (r *pageSuggestionRepository) Get(ctx context.Context, workspaceID, pageID, suggestionID string) (*domain.PageSuggestion, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	sgID, ok3 := kbParseID(suggestionID)
	if !ok || !ok2 || !ok3 {
		return nil, domain.ErrPageSuggestionNotFound
	}
	row, err := r.queries(ctx).GetPageSuggestion(ctx, sqlcgen.GetPageSuggestionParams{
		WorkspaceID: wsID, PageID: pgID, ID: sgID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, domain.ErrPageSuggestionNotFound
	}
	if err != nil {
		return nil, err
	}
	s := toDomainPageSuggestion(row)
	return &s, nil
}

func (r *pageSuggestionRepository) Resolve(
	ctx context.Context, workspaceID, pageID, suggestionID string,
	status domain.PageSuggestionStatus, resolverUserID uint64, resolvedAt time.Time,
) (*domain.PageSuggestion, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	sgID, ok3 := kbParseID(suggestionID)
	if !ok || !ok2 || !ok3 {
		return nil, domain.ErrPageSuggestionNotFound
	}
	resolverID, ok4 := toInt64ID(resolverUserID)
	if !ok4 {
		return nil, outOfRangeIDError("resolved_by_user_id", resolverUserID)
	}
	row, err := r.queries(ctx).ResolvePageSuggestion(ctx, sqlcgen.ResolvePageSuggestionParams{
		Status:           string(status),
		ResolvedAt:       sql.NullTime{Time: resolvedAt, Valid: true},
		ResolvedByUserID: sql.NullInt64{Int64: resolverID, Valid: true},
		WorkspaceID:      wsID,
		PageID:           pgID,
		ID:               sgID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		// 0 行だった理由は「そもそも無い」と「open ではない（解決済み）」のどちらかありうる。
		// 追加の Get で区別する（queries/page_suggestion.sql の ResolvePageSuggestion 参照）。
		if _, getErr := r.Get(ctx, workspaceID, pageID, suggestionID); getErr != nil {
			return nil, getErr
		}
		return nil, domain.ErrPageSuggestionAlreadyResolved
	}
	if err != nil {
		return nil, err
	}
	s := toDomainPageSuggestion(row)
	return &s, nil
}
