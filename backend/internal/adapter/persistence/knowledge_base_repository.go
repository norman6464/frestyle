package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// knowledgeBaseRepository は [repository.KnowledgeBaseRepository] の実装。ナレッジはスキーマ正本が
// schema.hcl で GORM を通さない方針のため、sqlc 生成コード + 素の *sql.DB で書く。複数テーブルに
// またがる書き込みは runInTx が自前のトランザクションで閉じるが、外側の TxManager.DoInTx が
// 既にトランザクションを開いていればそちらへ相乗りする。
type knowledgeBaseRepository struct {
	baseRepository
}

func NewKnowledgeBaseRepository(db *sql.DB) repository.KnowledgeBaseRepository {
	return &knowledgeBaseRepository{baseRepository{db: db}}
}

// queries は ctx に乗っているトランザクション（あれば）に束縛した sqlc の Queries を作る。
func (r *knowledgeBaseRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

// runInTx は 1 つのトランザクションを開き、その中でだけ有効な Queries を fn に渡す。
// ctx に既に外側の DoInTx が開いたトランザクションがあれば、新規に開始せずそれへ相乗りする
// （二重に BeginTx するとデッドロックの原因になる。commit/rollback は外側だけが持つ）。
func (r *knowledgeBaseRepository) runInTx(ctx context.Context, fn func(qtx *sqlcgen.Queries) error) error {
	if tx, ok := getTx(ctx); ok {
		return fn(sqlcgen.New(tx))
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }() // Commit 済みなら no-op
	if err := fn(sqlcgen.New(tx)); err != nil {
		return err
	}
	return tx.Commit()
}

// kbParseID は文字列 ID を uuid に変換する。不正な形式は「存在し得ない ID = not found」として
// 扱えるよう ok=false を返す（URL 由来の生文字列を DB エラーにしないため）。
func kbParseID(id string) (uuid.UUID, bool) {
	u, err := uuid.Parse(id)
	if err != nil {
		return uuid.UUID{}, false
	}
	return u, true
}

// kbNullID は NULL 可の親 ID（*string）を uuid.NullUUID へ変換する。
func kbNullID(id *string) (uuid.NullUUID, bool) {
	if id == nil {
		return uuid.NullUUID{}, true
	}
	u, ok := kbParseID(*id)
	if !ok {
		return uuid.NullUUID{}, false
	}
	return uuid.NullUUID{UUID: u, Valid: true}, true
}

// PostgreSQL の SQLSTATE。制約違反を「業務上の衝突」へ翻訳するのに使う。
const (
	sqlStateUniqueViolation     = "23505"
	sqlStateForeignKeyViolation = "23503"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == sqlStateUniqueViolation
}

// uniqueViolationConstraint は一意制約違反のとき、違反した制約名を返す。1 つの INSERT が
// 複数の一意制約を持ちうる場合、名前を見ないとどの制約が競合したか区別できない。
func uniqueViolationConstraint(err error) (string, bool) {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != sqlStateUniqueViolation {
		return "", false
	}
	return pgErr.ConstraintName, true
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == sqlStateForeignKeyViolation
}

// foreignKeyViolationConstraint は外部キー違反の制約名を返す（uniqueViolationConstraint と
// 同じ理由: 複数 FK を持つ INSERT では名前を見ないとどの参照が無いのか区別できない）。
func foreignKeyViolationConstraint(err error) (string, bool) {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != sqlStateForeignKeyViolation {
		return "", false
	}
	return pgErr.ConstraintName, true
}

// kbNewID は UUIDv7 を採番する。時系列で単調に増える（インデックス局所性が良い）うえ、
// ランダム部により URL は推測困難のまま。失敗は乱数源の故障なのでエラーで返す。
func kbNewID() (uuid.UUID, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("uuid v7 の採番に失敗: %w", err)
	}
	return id, nil
}

func toDomainWorkspace(row sqlcgen.Workspace) domain.Workspace {
	return domain.Workspace{
		ID:        row.ID.String(),
		Slug:      row.Slug,
		Name:      row.Name,
		IsActive:  row.IsActive,
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}

func toDomainSpace(row sqlcgen.Space) domain.Space {
	return domain.Space{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		Key:         row.Key,
		Name:        row.Name,
		Visibility:  domain.SpaceVisibility(row.Visibility),
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toDomainPage(row sqlcgen.Page) domain.Page {
	p := domain.Page{
		ID:              row.ID.String(),
		WorkspaceID:     row.WorkspaceID.String(),
		SpaceID:         row.SpaceID.String(),
		Position:        row.Position,
		Title:           row.Title,
		CreatedByUserID: uint64(row.CreatedByUserID),
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
		Visibility:      domain.PageVisibility(row.Visibility),
	}
	if row.ParentID.Valid {
		id := row.ParentID.UUID.String()
		p.ParentID = &id
	}
	if row.ArchivedAt.Valid {
		t := row.ArchivedAt.Time
		p.ArchivedAt = &t
	}
	if row.LastEditedByUserID.Valid {
		id := uint64(row.LastEditedByUserID.Int64)
		p.LastEditedByUserID = &id
	}
	// icon / cover は飾り（見た目）であって、壊れていてもページ本体の読み出しを止める理由には
	// ならない。json.Unmarshal に失敗したら nil に倒し、タイトルや本文は普通に返す。
	if row.Icon != nil {
		var icon domain.PageIcon
		if err := json.Unmarshal(*row.Icon, &icon); err == nil {
			p.Icon = &icon
		}
	}
	if row.Cover != nil {
		var cover domain.PageCover
		if err := json.Unmarshal(*row.Cover, &cover); err == nil {
			p.Cover = &cover
		}
	}
	return p
}

func toDomainBlock(row sqlcgen.Block) domain.Block {
	b := domain.Block{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		PageID:      row.PageID.String(),
		Position:    row.Position,
		Type:        domain.BlockType(row.Type),
		Attrs:       string(row.Attrs),
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
	if row.ParentID.Valid {
		id := row.ParentID.UUID.String()
		b.ParentID = &id
	}
	if row.Inline != nil {
		s := string(*row.Inline)
		b.Inline = &s
	}
	return b
}

func toDomainPageSnapshot(row sqlcgen.PageSnapshot) domain.PageSnapshot {
	return domain.PageSnapshot{
		PageID:  row.PageID.String(),
		Doc:     string(row.Doc),
		BuiltAt: row.BuiltAt,
	}
}

// DeleteWorkspace はワークスペースを配下ごと消す。
//
// 0 行は「無かった」と「人が居て消さなかった」のどちらもあり得る（SQL は人が居る行を
// WHERE で弾くだけ）。実在を引き直し、在るのに消えなかった場合だけ ErrWorkspaceHasMembers とする。
func (r *knowledgeBaseRepository) DeleteWorkspace(ctx context.Context, workspaceID string) error {
	id, ok := kbParseID(workspaceID)
	if !ok {
		return repository.ErrWorkspaceNotFound
	}
	affected, err := r.queries(ctx).DeleteWorkspace(ctx, id)
	if err != nil {
		return err
	}
	if affected > 0 {
		return nil
	}
	if _, err := r.queries(ctx).GetWorkspaceByID(ctx, id); errors.Is(err, sql.ErrNoRows) {
		return repository.ErrWorkspaceNotFound
	} else if err != nil {
		return err
	}
	return repository.ErrWorkspaceHasMembers
}

func (r *knowledgeBaseRepository) FindWorkspaceByID(ctx context.Context, workspaceID string) (*domain.Workspace, error) {
	id, ok := kbParseID(workspaceID)
	if !ok {
		return nil, repository.ErrWorkspaceNotFound
	}
	row, err := r.queries(ctx).GetWorkspaceByID(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrWorkspaceNotFound
	}
	if err != nil {
		return nil, err
	}
	ws := toDomainWorkspace(row)
	return &ws, nil
}

func (r *knowledgeBaseRepository) FindPersonalWorkspaceByOwner(ctx context.Context, userID uint64) (*domain.Workspace, error) {
	id, ok := toInt64ID(userID)
	if !ok {
		return nil, repository.ErrWorkspaceNotFound
	}
	row, err := r.queries(ctx).GetPersonalWorkspaceByOwner(ctx, sql.NullInt64{Int64: id, Valid: true})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrWorkspaceNotFound
	}
	if err != nil {
		return nil, err
	}
	ws := toDomainWorkspace(row)
	return &ws, nil
}

// ListAllWorkspaceIDs は全ワークスペースの id を返す（cmd/rebuildsearchindex 専用。
// repository.KnowledgeBaseRepository の doc 参照）。
func (r *knowledgeBaseRepository) ListAllWorkspaceIDs(ctx context.Context) ([]string, error) {
	rows, err := r.queries(ctx).ListAllWorkspaceIDs(ctx)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, id := range rows {
		ids = append(ids, id.String())
	}
	return ids, nil
}

func (r *knowledgeBaseRepository) FindWorkspaceBySlug(ctx context.Context, slug string) (*domain.Workspace, error) {
	if slug == "" {
		return nil, repository.ErrWorkspaceNotFound
	}
	row, err := r.queries(ctx).GetWorkspaceBySlug(ctx, slug)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrWorkspaceNotFound
	}
	if err != nil {
		return nil, err
	}
	ws := toDomainWorkspace(row)
	return &ws, nil
}

// FindPageByIDAcrossWorkspaces はページを ID だけで引く（詳細は port のコメント）。
func (r *knowledgeBaseRepository) FindPageByIDAcrossWorkspaces(ctx context.Context, pageID string) (*domain.Page, error) {
	pgID, ok := kbParseID(pageID)
	if !ok {
		return nil, repository.ErrPageNotFound
	}
	row, err := r.queries(ctx).GetPageAcrossWorkspaces(ctx, pgID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPage(row)
	return &p, nil
}

func (r *knowledgeBaseRepository) ListAncestorPageIDs(ctx context.Context, workspaceID, pageID string) ([]string, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return []string{}, nil
	}
	rows, err := r.queries(ctx).ListPageAncestorIDs(ctx, sqlcgen.ListPageAncestorIDsParams{
		WorkspaceID: wsID,
		PageID:      pgID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(rows))
	for _, id := range rows {
		out = append(out, id.String())
	}
	return out, nil
}

func (r *knowledgeBaseRepository) DeletePageSubtree(ctx context.Context, workspaceID, pageID string) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return repository.ErrPageNotFound
	}
	rows, err := r.queries(ctx).DeletePage(ctx, sqlcgen.DeletePageParams{WorkspaceID: wsID, ID: pgID})
	if err != nil {
		return err
	}
	if rows == 0 {
		return repository.ErrPageNotFound
	}
	return nil
}

func (r *knowledgeBaseRepository) FindSpace(ctx context.Context, workspaceID, spaceID string) (*domain.Space, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return nil, repository.ErrSpaceNotFound
	}
	row, err := r.queries(ctx).GetSpace(ctx, sqlcgen.GetSpaceParams{WorkspaceID: wsID, ID: spID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrSpaceNotFound
	}
	if err != nil {
		return nil, err
	}
	sp := toDomainSpace(row)
	return &sp, nil
}

// UpdateSpaceName はスペースの表示名を変える。0 件更新は「無い」と同じ扱いで
// ErrSpaceNotFound（別ワークスペースの ID も WHERE の workspace_id でここに落ちる）。
func (r *knowledgeBaseRepository) UpdateSpaceName(ctx context.Context, workspaceID, spaceID, name string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return repository.ErrSpaceNotFound
	}
	affected, err := r.queries(ctx).UpdateSpaceName(ctx, sqlcgen.UpdateSpaceNameParams{
		WorkspaceID: wsID,
		ID:          spID,
		Name:        name,
	})
	if err != nil {
		return err
	}
	if affected == 0 {
		return repository.ErrSpaceNotFound
	}
	return nil
}

func (r *knowledgeBaseRepository) CreateSpace(ctx context.Context, space *domain.Space) error {
	wsID, ok := kbParseID(space.WorkspaceID)
	if !ok {
		return repository.ErrWorkspaceNotFound
	}
	id, err := kbNewID()
	if err != nil {
		return err
	}
	// ゼロ値（visibility 未指定の呼び出し）は既定の 'workspace' に倒す。
	// 空文字のまま送ると CHECK 制約（ck_spaces_visibility）で落ちる。
	visibility := space.Visibility
	if visibility == "" {
		visibility = domain.SpaceVisibilityWorkspace
	}
	row, err := r.queries(ctx).InsertSpace(ctx, sqlcgen.InsertSpaceParams{
		ID:          id,
		WorkspaceID: wsID,
		Key:         space.Key,
		Name:        space.Name,
		Visibility:  string(visibility),
	})
	if err != nil {
		// key の重複は検査後の INSERT までの間に起き得る TOCTOU なので、一意制約を唯一の判定にする。
		if isUniqueViolation(err) {
			return repository.ErrSpaceKeyTaken
		}
		// ワークスペースが実在しなければ FK 違反。500 ではなく「無い」に翻訳する。
		if isForeignKeyViolation(err) {
			return repository.ErrWorkspaceNotFound
		}
		return err
	}
	*space = toDomainSpace(row)
	return nil
}

func (r *knowledgeBaseRepository) FindPage(ctx context.Context, workspaceID, pageID string) (*domain.Page, error) {
	return findPageWith(ctx, r.queries(ctx), workspaceID, pageID)
}

// findPageWith はトランザクション内外の両方から使うページ取得の実体。
func findPageWith(ctx context.Context, q *sqlcgen.Queries, workspaceID, pageID string) (*domain.Page, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, repository.ErrPageNotFound
	}
	row, err := q.GetPage(ctx, sqlcgen.GetPageParams{WorkspaceID: wsID, ID: pgID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPage(row)
	return &p, nil
}

func (r *knowledgeBaseRepository) ListActivePagesBySpace(ctx context.Context, workspaceID, spaceID string) ([]domain.Page, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return []domain.Page{}, nil
	}
	rows, err := r.queries(ctx).ListActivePagesBySpace(ctx, sqlcgen.ListActivePagesBySpaceParams{WorkspaceID: wsID, SpaceID: spID})
	if err != nil {
		return nil, err
	}
	pages := make([]domain.Page, 0, len(rows))
	for _, row := range rows {
		pages = append(pages, toDomainPage(row))
	}
	return pages, nil
}

// ListActivePageIDsByWorkspace はワークスペース全体の現役ページ id を返す
// （cmd/rebuildsearchindex 専用。repository.KnowledgeBaseRepository の doc 参照）。
func (r *knowledgeBaseRepository) ListActivePageIDsByWorkspace(ctx context.Context, workspaceID string) ([]string, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []string{}, nil
	}
	rows, err := r.queries(ctx).ListActivePageIDsByWorkspace(ctx, wsID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, id := range rows {
		ids = append(ids, id.String())
	}
	return ids, nil
}

func (r *knowledgeBaseRepository) SiblingPositionsAround(
	ctx context.Context, workspaceID, spaceID string, parentID *string, anchorPageID, movingPageID string,
) (bool, string, string, string, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	parent, ok3 := kbNullID(parentID)
	anchorID, ok4 := kbParseID(anchorPageID)
	// movingPageID が空なら「除くものが無い」。どのページの ID とも一致しない値を渡して
	// 除外条件を無効化する。
	movingID := uuid.Nil
	ok5 := true
	if movingPageID != "" {
		movingID, ok5 = kbParseID(movingPageID)
	}
	if !ok || !ok2 || !ok3 || !ok4 || !ok5 {
		// UUID ですらない値はどの兄弟にも一致しない。見つからなかったときと同じ扱いにする
		// （エラーにはしない）。
		return false, "", "", "", nil
	}
	row, err := r.queries(ctx).SiblingPositionsAround(ctx, sqlcgen.SiblingPositionsAroundParams{
		WorkspaceID:  wsID,
		SpaceID:      spID,
		ParentID:     parent,
		AnchorPageID: anchorID,
		MovingPageID: movingID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return false, "", "", "", nil
	}
	if err != nil {
		return false, "", "", "", err
	}
	return row.Found, row.PrevPosition, row.AnchorPosition, row.NextPosition, nil
}

func (r *knowledgeBaseRepository) LastActiveSiblingPosition(ctx context.Context, workspaceID, spaceID string, parentID *string) (string, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	parent, ok3 := kbNullID(parentID)
	if !ok || !ok2 || !ok3 {
		return "", nil
	}
	pos, err := r.queries(ctx).GetLastActiveSiblingPosition(ctx, sqlcgen.GetLastActiveSiblingPositionParams{
		WorkspaceID: wsID,
		SpaceID:     spID,
		ParentID:    parent,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil // 兄弟なし = fracindex.Between の「端」
	}
	if err != nil {
		return "", err
	}
	return pos, nil
}

func (r *knowledgeBaseRepository) HasActiveSiblingPosition(ctx context.Context, workspaceID, spaceID string, parentID *string, position, excludePageID string) (bool, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	parent, ok3 := kbNullID(parentID)
	exID, ok4 := kbParseID(excludePageID)
	if !ok || !ok2 || !ok3 || !ok4 {
		return false, nil
	}
	return r.queries(ctx).HasActiveSiblingPosition(ctx, sqlcgen.HasActiveSiblingPositionParams{
		WorkspaceID:    wsID,
		SpaceID:        spID,
		ParentID:       parent,
		Position:       position,
		ExcludedPageID: exID,
	})
}

func (r *knowledgeBaseRepository) HasDescendant(ctx context.Context, workspaceID, pageID, candidateID string) (bool, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	cdID, ok3 := kbParseID(candidateID)
	if !ok || !ok2 || !ok3 {
		return false, nil
	}
	return r.queries(ctx).PageHasDescendant(ctx, sqlcgen.PageHasDescendantParams{
		WorkspaceID: wsID,
		AncestorID:  pgID,
		PageID:      cdID,
	})
}

// validatePagePlacement は階層ロックを取得したトランザクション内で呼ぶ。
func validatePagePlacement(ctx context.Context, qtx *sqlcgen.Queries, workspaceID uuid.UUID, parent uuid.NullUUID, height int32) error {
	var parentDepth int32
	if parent.Valid {
		dimensions, err := qtx.GetPageDepthAndHeight(ctx, sqlcgen.GetPageDepthAndHeightParams{WorkspaceID: workspaceID, PageID: parent.UUID})
		if errors.Is(err, sql.ErrNoRows) {
			return repository.ErrPageNotFound
		}
		if err != nil {
			return err
		}
		parentDepth = dimensions.Depth
	}
	return domain.ValidatePageDepth(parentDepth, height)
}

func (r *knowledgeBaseRepository) CreatePage(ctx context.Context, page *domain.Page) error {
	wsID, ok := kbParseID(page.WorkspaceID)
	spID, ok2 := kbParseID(page.SpaceID)
	parent, ok3 := kbNullID(page.ParentID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrPageNotFound
	}
	// pages.created_by_user_id は bigint。素の int64(page.CreatedByUserID) は math.MaxInt64 超で
	// 負数へ巻き戻り、無関係な id を作成者として記録し得るため、範囲外なら書き込み前にエラーで
	// 止める（nil を返すと作成できたと誤認される）。
	createdBy, ok4 := toInt64ID(page.CreatedByUserID)
	if !ok4 {
		return outOfRangeIDError("created_by_user_id", page.CreatedByUserID)
	}
	id, err := kbNewID()
	if err != nil {
		return err
	}

	var created sqlcgen.Page
	err = r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		if _, err := qtx.LockPageHierarchy(ctx, wsID); err != nil {
			return err
		}
		if err := validatePagePlacement(ctx, qtx, wsID, parent, 0); err != nil {
			return err
		}
		row, err := qtx.InsertPage(ctx, sqlcgen.InsertPageParams{
			ID:              id,
			WorkspaceID:     wsID,
			SpaceID:         spID,
			ParentID:        parent,
			Position:        page.Position,
			Title:           page.Title,
			CreatedByUserID: createdBy,
		})
		if err != nil {
			return err
		}
		// closure: 自分自身（depth=0）と、親があれば親の祖先集合 +1。
		if err := qtx.InsertPagePathSelf(ctx, sqlcgen.InsertPagePathSelfParams{WorkspaceID: wsID, PageID: id}); err != nil {
			return err
		}
		if parent.Valid {
			if err := qtx.InsertPagePathAncestors(ctx, sqlcgen.InsertPagePathAncestorsParams{
				PageID:      id,
				WorkspaceID: wsID,
				ParentID:    parent.UUID,
			}); err != nil {
				return err
			}
		}
		created = row
		return nil
	})
	if err != nil {
		return err
	}
	*page = toDomainPage(created)
	return nil
}

func (r *knowledgeBaseRepository) UpdatePageTitle(ctx context.Context, workspaceID, pageID, title string) (*domain.Page, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, repository.ErrPageNotFound
	}
	row, err := r.queries(ctx).UpdatePageTitle(ctx, sqlcgen.UpdatePageTitleParams{WorkspaceID: wsID, ID: pgID, Title: title})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPage(row)
	return &p, nil
}

func (r *knowledgeBaseRepository) UpdatePageIcon(ctx context.Context, workspaceID, pageID string, icon *domain.PageIcon) (*domain.Page, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, repository.ErrPageNotFound
	}
	var raw *json.RawMessage
	if icon != nil {
		// 正規形（domain.PageIcon を Marshal し直したもの）だけを書く。呼び出し側から
		// 渡された値をそのまま書かないのは、フィールド順・空白の揺れを DB に持ち込まないため。
		encoded, err := json.Marshal(icon)
		if err != nil {
			return nil, err
		}
		msg := json.RawMessage(encoded)
		raw = &msg
	}
	row, err := r.queries(ctx).UpdatePageIcon(ctx, sqlcgen.UpdatePageIconParams{Icon: raw, WorkspaceID: wsID, ID: pgID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPage(row)
	return &p, nil
}

func (r *knowledgeBaseRepository) UpdatePageCover(ctx context.Context, workspaceID, pageID string, cover *domain.PageCover) (*domain.Page, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, repository.ErrPageNotFound
	}
	var raw *json.RawMessage
	if cover != nil {
		// UpdatePageIcon と同じく、正規形（domain.PageCover を Marshal し直したもの）だけを書く。
		encoded, err := json.Marshal(cover)
		if err != nil {
			return nil, err
		}
		msg := json.RawMessage(encoded)
		raw = &msg
	}
	row, err := r.queries(ctx).UpdatePageCover(ctx, sqlcgen.UpdatePageCoverParams{Cover: raw, WorkspaceID: wsID, ID: pgID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPage(row)
	return &p, nil
}

func (r *knowledgeBaseRepository) UpdatePageVisibility(ctx context.Context, workspaceID, pageID string, visibility domain.PageVisibility) (*domain.Page, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, repository.ErrPageNotFound
	}
	row, err := r.queries(ctx).UpdatePageVisibility(ctx, sqlcgen.UpdatePageVisibilityParams{
		Visibility: string(visibility), WorkspaceID: wsID, ID: pgID,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPage(row)
	return &p, nil
}

func (r *knowledgeBaseRepository) TouchPageLastEditedBy(ctx context.Context, workspaceID, pageID string, userID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	uid, ok3 := toInt64ID(userID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrPageNotFound
	}
	n, err := r.queries(ctx).TouchPageLastEditedBy(ctx, sqlcgen.TouchPageLastEditedByParams{
		UserID:      uid,
		WorkspaceID: wsID,
		ID:          pgID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrPageNotFound
	}
	return nil
}

func (r *knowledgeBaseRepository) MovePage(ctx context.Context, workspaceID, pageID string, newParentID *string, newSpaceID, newPosition string) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	parent, ok3 := kbNullID(newParentID)
	spID, ok4 := kbParseID(newSpaceID)
	if !ok || !ok2 || !ok3 || !ok4 {
		return repository.ErrPageNotFound
	}

	return r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		if _, err := qtx.LockPageHierarchy(ctx, wsID); err != nil {
			return err
		}
		// usecaseの確認後に別の移動が完了している場合も、ロック内で循環を拒否する。
		if parent.Valid {
			cycle, err := qtx.PageHasDescendant(ctx, sqlcgen.PageHasDescendantParams{
				WorkspaceID: wsID, AncestorID: pgID, PageID: parent.UUID,
			})
			if err != nil {
				return err
			}
			if cycle {
				return domain.ErrPageCycle
			}
		}
		dimensions, err := qtx.GetPageDepthAndHeight(ctx, sqlcgen.GetPageDepthAndHeightParams{WorkspaceID: wsID, PageID: pgID})
		if errors.Is(err, sql.ErrNoRows) {
			return repository.ErrPageNotFound
		}
		if err != nil {
			return err
		}
		if err := validatePagePlacement(ctx, qtx, wsID, parent, dimensions.Height); err != nil {
			return err
		}
		current, err := findPageWith(ctx, qtx, workspaceID, pageID)
		if err != nil {
			return err
		}
		if current.SpaceID == newSpaceID {
			n, err := qtx.MovePageWithinSpace(ctx, sqlcgen.MovePageWithinSpaceParams{
				NewParentID: parent,
				NewPosition: newPosition,
				WorkspaceID: wsID,
				PageID:      pgID,
			})
			if err != nil {
				return err
			}
			if n == 0 {
				return repository.ErrPageNotFound
			}
		} else {
			// 「そのスペースの全員」宛ての付与はスペースをまたぐと評価されなくなる（画面には
			// 見えているのに効かない状態になる）。移動と同じトランザクションで調べて拒否する。
			voids, err := qtx.SubtreeHasForeignSpaceAllGrant(ctx, sqlcgen.SubtreeHasForeignSpaceAllGrantParams{
				WorkspaceID: wsID,
				PageID:      pgID,
				NewSpaceID:  spID,
			})
			if err != nil {
				return err
			}
			if voids {
				return repository.ErrPageMoveVoidsSpaceGrant
			}
			// スペースをまたぐ移動は本人 + 子孫の space_id を 1 文で更新する（クエリ側コメント参照）。
			n, err := qtx.MovePageSubtreeToSpace(ctx, sqlcgen.MovePageSubtreeToSpaceParams{
				NewSpaceID:  spID,
				PageID:      pgID,
				NewParentID: parent,
				NewPosition: newPosition,
				WorkspaceID: wsID,
			})
			if err != nil {
				return err
			}
			if n == 0 {
				return repository.ErrPageNotFound
			}
		}
		// closure の付け替え: 旧祖先との組を消してから、新しい親の祖先集合との組を張る。
		// 順序は Detach → Attach 固定（逆にすると Attach で張った行を Detach が消してしまう）。
		if err := qtx.DetachPageSubtreePaths(ctx, sqlcgen.DetachPageSubtreePathsParams{
			WorkspaceID: wsID,
			PageID:      pgID,
		}); err != nil {
			return err
		}
		if parent.Valid {
			if err := qtx.AttachPageSubtreePaths(ctx, sqlcgen.AttachPageSubtreePathsParams{
				NewParentID: parent.UUID,
				WorkspaceID: wsID,
				PageID:      pgID,
			}); err != nil {
				return err
			}
		}
		return nil
	})
}

// ArchivePageSubtree は根とその子孫をまとめてアーカイブする。
//
// UPDATE は 0 行一致でも成功するため、件数を捨てると消えたはずのページが残ったまま
// 204 を返してしまう。根も含めて畳む文なので、成功なら必ず 1 行以上に当たる — 0 行は
// 「ワークスペースに無い」ことしか意味しない（呼び出し側は事前に FindPage 済みなので、
// ここに落ちるのは確認後にページが消えた競合のときだけ）。
func (r *knowledgeBaseRepository) ArchivePageSubtree(ctx context.Context, workspaceID, pageID string) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return repository.ErrPageNotFound
	}
	// 1 文で完結する（サブツリー全行に同じ now() が入る）ためトランザクション不要。
	// :execrows なので実際に畳んだ行数が返る（捨てると 0 行でも成功と区別が付かない）。
	n, err := r.queries(ctx).ArchivePageSubtree(ctx, sqlcgen.ArchivePageSubtreeParams{WorkspaceID: wsID, AncestorID: pgID})
	if err != nil {
		return err
	}
	if n == 0 {
		return repository.ErrPageNotFound
	}
	return nil
}

func (r *knowledgeBaseRepository) UnarchivePageSubtree(ctx context.Context, workspaceID, pageID string, archivedSince time.Time, newRootPosition *string) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return repository.ErrPageNotFound
	}

	return r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		// 現役の兄弟と position が衝突する場合は、まだアーカイブ済み（部分 UNIQUE 対象外）のうちに
		// 根の position を振り直してから現役へ戻す。振り直しが 0 行なら根のページが無いということ
		// で、そのまま進めると UNIQUE 違反か原因不明の無反応成功になるため、ここで打ち切る。
		if newRootPosition != nil {
			n, err := qtx.SetPagePosition(ctx, sqlcgen.SetPagePositionParams{
				WorkspaceID: wsID,
				ID:          pgID,
				Position:    *newRootPosition,
			})
			if err != nil {
				return err
			}
			if n == 0 {
				return repository.ErrPageNotFound
			}
		}
		// 根も含めて戻す文なので、成功したなら必ず 1 行以上に当たる。0 行のまま成功を返すと
		// handler が 200 を返し、アーカイブされたままのページを復帰済みとして描画してしまう。
		n, err := qtx.UnarchivePageSubtree(ctx, sqlcgen.UnarchivePageSubtreeParams{
			WorkspaceID:   wsID,
			ArchivedSince: sql.NullTime{Time: archivedSince, Valid: true},
			PageID:        pgID,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return repository.ErrPageNotFound
		}
		return nil
	})
}

func (r *knowledgeBaseRepository) ListBlocksByPage(ctx context.Context, workspaceID, pageID string) ([]domain.Block, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return []domain.Block{}, nil
	}
	rows, err := r.queries(ctx).ListBlocksByPage(ctx, sqlcgen.ListBlocksByPageParams{WorkspaceID: wsID, PageID: pgID})
	if err != nil {
		return nil, err
	}
	blocks := make([]domain.Block, 0, len(rows))
	for _, row := range rows {
		blocks = append(blocks, toDomainBlock(row))
	}
	return blocks, nil
}

// ReplacePageBlocks は本文を差分 UPSERT で書き換える（全消し全入れではない）。
//
// comment_threads.block_id は将来 blocks.id を ON DELETE SET NULL で参照する予定で、保存の
// たびに全消し全入れすると DELETE の瞬間に全コメントの紐付けが外れてしまう。そのため消えた
// id だけ DELETE し、生き残る id は UPDATE（行は同一なので FK は保たれる）、新規だけ INSERT する。
func (r *knowledgeBaseRepository) ReplacePageBlocks(
	ctx context.Context, workspaceID, pageID string, blocks []repository.BlockWrite, snapshotDoc, title, body string,
	pageLinks []repository.PageLinkWrite, pageTicketLinks []repository.PageTicketLinkWrite,
) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return repository.ErrPageNotFound
	}

	return r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		// page_snapshots は workspace_id を持たないため、同一トランザクション内で
		// ページの所属を必ず検証してから書く（テナント越えの snapshot 書き込みを塞ぐ）。
		if _, err := findPageWith(ctx, qtx, workspaceID, pageID); err != nil {
			return err
		}

		// 各 BlockWrite.ID を検証する。usecase 側（flattenPageDoc）が必ず有効な UUID を
		// 埋めている前提なので、parse 失敗はバグの証拠としてそのままエラーを返す。
		incomingIDs := make([]uuid.UUID, len(blocks))
		for i, b := range blocks {
			id, err := uuid.Parse(b.ID)
			if err != nil {
				return fmt.Errorf("blocks[%d].ID が不正な UUID です: %w", i, err)
			}
			incomingIDs[i] = id
		}

		existingRows, err := qtx.ListPageBlockIDs(ctx, sqlcgen.ListPageBlockIDsParams{WorkspaceID: wsID, PageID: pgID})
		if err != nil {
			return err
		}
		existing := make(map[uuid.UUID]bool, len(existingRows))
		for _, id := range existingRows {
			existing[id] = true
		}
		incoming := make(map[uuid.UUID]bool, len(incomingIDs))
		for _, id := range incomingIDs {
			incoming[id] = true
		}

		// incoming のうち existing に無いもの＝newIDs。他ページの行を乗っ取ろうとしていないかを
		// 確認し、1 件でも見つかれば保存ごと拒否する。
		newIDs := make([]uuid.UUID, 0, len(incoming))
		for id := range incoming {
			if !existing[id] {
				newIDs = append(newIDs, id)
			}
		}
		if len(newIDs) > 0 {
			idsJSON, err := json.Marshal(newIDs)
			if err != nil {
				return err
			}
			conflicting, err := qtx.ListExistingBlockIDsAmong(ctx, idsJSON)
			if err != nil {
				return err
			}
			if len(conflicting) > 0 {
				return repository.ErrBlockIDConflict
			}
		}

		// existing にあって incoming に無いもの＝toDelete。ページから消えた行を削除する
		// （comment_threads.block_id の ON DELETE SET NULL がここで発火する）。
		toDelete := make([]uuid.UUID, 0, len(existing))
		for id := range existing {
			if !incoming[id] {
				toDelete = append(toDelete, id)
			}
		}
		if len(toDelete) > 0 {
			idsJSON, err := json.Marshal(toDelete)
			if err != nil {
				return err
			}
			if err := qtx.DeleteBlocksByIDs(ctx, sqlcgen.DeleteBlocksByIDsParams{
				WorkspaceID: wsID,
				PageID:      pgID,
				Ids:         idsJSON,
			}); err != nil {
				return err
			}
		}

		// kept（existing かつ incoming）は position を一時値へ退避してから本来値を書く
		// （flattenPageDoc が振り直す position が、まだ古い position の別の生存行と衝突するのを
		// 避けるため。ParkBlockPositions のコメント参照）。
		kept := make([]uuid.UUID, 0, len(existing))
		for id := range existing {
			if incoming[id] {
				kept = append(kept, id)
			}
		}
		if len(kept) > 0 {
			idsJSON, err := json.Marshal(kept)
			if err != nil {
				return err
			}
			if err := qtx.ParkBlockPositions(ctx, sqlcgen.ParkBlockPositionsParams{
				WorkspaceID: wsID,
				PageID:      pgID,
				Ids:         idsJSON,
			}); err != nil {
				return err
			}
		}

		// 入力の順序（flattenPageDoc が親を先に出す文書順）のまま 1 件ずつ UPSERT する。新規の親を
		// 参照する新規ブロックは親が先に UPSERT 済みでないと fk_blocks_parent に落ちるため、この
		// 順序を変えてはいけない。ParentID の dangling 参照は事前検証せず、FK 違反に任せる。
		for i, b := range blocks {
			var parent uuid.NullUUID
			if b.ParentID != nil {
				pid, err := uuid.Parse(*b.ParentID)
				if err != nil {
					return fmt.Errorf("blocks[%d].ParentID が不正な UUID です: %w", i, err)
				}
				parent = uuid.NullUUID{UUID: pid, Valid: true}
			}
			var inline *json.RawMessage
			if b.Inline != nil {
				raw := json.RawMessage(*b.Inline)
				inline = &raw
			}
			rows, err := qtx.UpsertBlock(ctx, sqlcgen.UpsertBlockParams{
				ID:          incomingIDs[i],
				WorkspaceID: wsID,
				PageID:      pgID,
				ParentID:    parent,
				Position:    b.Position,
				Type:        string(b.Type),
				Attrs:       json.RawMessage(b.Attrs),
				Inline:      inline,
			})
			if err != nil {
				return err
			}
			if rows == 0 {
				// 事前の ListExistingBlockIDsAmong は行をロックしない。別ページ/別ワークスペースの
				// 保存が同じ id を先に INSERT するレースが起きると、UpsertBlock の WHERE が偽になり
				// 0 行のまま何も書かれない。:exec のままでは検知できず保存成功と誤認するため、
				// ここで検知して ErrBlockIDConflict に倒す。
				return repository.ErrBlockIDConflict
			}
		}

		if err := qtx.UpsertPageSnapshot(ctx, sqlcgen.UpsertPageSnapshotParams{
			PageID: pgID,
			Doc:    json.RawMessage(snapshotDoc),
		}); err != nil {
			return err
		}

		// page_search / page_links の同期。中核ロジックは writePageSearchAndLinks を
		// RebuildPageSearchAndLinks と共有する。
		return writePageSearchAndLinks(ctx, qtx, wsID, pgID, title, body, pageLinks, pageTicketLinks)
	})
}

func (r *knowledgeBaseRepository) GetPageSnapshot(ctx context.Context, workspaceID, pageID string) (*domain.PageSnapshot, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, repository.ErrPageSnapshotNotFound
	}
	row, err := r.queries(ctx).GetPageSnapshot(ctx, sqlcgen.GetPageSnapshotParams{WorkspaceID: wsID, PageID: pgID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPageSnapshotNotFound
	}
	if err != nil {
		return nil, err
	}
	s := toDomainPageSnapshot(row)
	return &s, nil
}
