package kb

// 目次：権限判定・可視性
// - CheckPagePermissionUseCase：ページの閲覧・編集権限を確認。
// - CanEditPageSubtreeUseCase：ページと全子孫の編集可否を確認。
// - CheckSpacePermissionUseCase：スペースの実効権限を確認。
// - CheckWorkspacePermissionUseCase：ワークスペースの実効権限を確認。
// - ListViewablePagesUseCase：閲覧できるページと見えない子の有無を取得。
// - ListViewableSpacesUseCase：閲覧できるスペースを取得。
// - SearchViewablePagesUseCase：閲覧できるページを検索。
// - ListPageBacklinksUseCase：閲覧できる逆リンク元を取得。
// - ListPagesReferencingTicketUseCase：閲覧できるチケット参照元を取得。

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

var ErrPagePermissionDenied = errors.New("permission denied for this page")

type CheckPagePermissionUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCheckPagePermissionUseCase(r repository.KnowledgeBasePermissionRepository) *CheckPagePermissionUseCase {
	return &CheckPagePermissionUseCase{repo: r}
}

type CheckPagePermissionInput struct {
	WorkspaceID string
	PageID      string
	UserID      uint64
}

func (u *CheckPagePermissionUseCase) Execute(ctx context.Context, in CheckPagePermissionInput) (*domain.PagePermission, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return nil, errors.New("pageID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.PagePermissionFactsForUser(ctx, in.WorkspaceID, in.PageID, in.UserID)
	if err != nil {
		return nil, err
	}
	perm := domain.ResolvePagePermission(*facts)
	return &perm, nil
}

type ListViewablePagesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListViewablePagesUseCase(r repository.KnowledgeBasePermissionRepository) *ListViewablePagesUseCase {
	return &ListViewablePagesUseCase{repo: r}
}

type ListViewablePagesInput struct {
	WorkspaceID string
	SpaceID     string
	UserID      uint64
	Archived    bool
}

const HiddenChildrenRootKey = ""

type ListViewablePagesOutput struct {
	Pages             []domain.Page
	HasHiddenChildren map[string]bool
	ParentArchived    map[string]bool
}

func (u *ListViewablePagesUseCase) Execute(ctx context.Context, in ListViewablePagesInput) (ListViewablePagesOutput, error) {
	if in.WorkspaceID == "" {
		return ListViewablePagesOutput{}, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return ListViewablePagesOutput{}, errors.New("spaceID is required")
	}
	if in.UserID == 0 {
		return ListViewablePagesOutput{}, errors.New("userID is required")
	}
	rows, err := u.repo.ListSpacePageViewFacts(ctx, in.WorkspaceID, in.SpaceID, in.UserID, in.Archived)
	if err != nil {
		return ListViewablePagesOutput{}, err
	}

	pages := make([]domain.Page, 0, len(rows))
	viewable := make(map[string]bool, len(rows))
	parentArchived := make(map[string]bool)
	for _, row := range rows {
		if domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			viewable[row.Page.ID] = true
			pages = append(pages, row.Page)
			if row.ParentArchived {
				parentArchived[row.Page.ID] = true
			}
		}
	}

	hasVisibleRoot := false
	for i := range pages {
		if pages[i].ParentID == nil {
			hasVisibleRoot = true
			break
		}
	}
	if !hasVisibleRoot {
		return ListViewablePagesOutput{Pages: pages, HasHiddenChildren: map[string]bool{}, ParentArchived: parentArchived}, nil
	}

	hidden := make(map[string]bool)
	for _, row := range rows {
		if viewable[row.Page.ID] {
			continue
		}
		if row.Page.ParentID == nil {
			hidden[HiddenChildrenRootKey] = true
			continue
		}
		if !viewable[*row.Page.ParentID] {
			continue
		}
		hidden[*row.Page.ParentID] = true
	}

	return ListViewablePagesOutput{Pages: pages, HasHiddenChildren: hidden, ParentArchived: parentArchived}, nil
}

type CanEditPageSubtreeUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCanEditPageSubtreeUseCase(r repository.KnowledgeBasePermissionRepository) *CanEditPageSubtreeUseCase {
	return &CanEditPageSubtreeUseCase{repo: r}
}

type CanEditPageSubtreeInput struct {
	WorkspaceID string
	PageID      string
	UserID      uint64
}

func (u *CanEditPageSubtreeUseCase) Execute(ctx context.Context, in CanEditPageSubtreeInput) (bool, error) {
	if in.WorkspaceID == "" {
		return false, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return false, errors.New("pageID is required")
	}
	if in.UserID == 0 {
		return false, errors.New("userID is required")
	}
	rows, err := u.repo.ListSubtreePagePermissionFacts(ctx, in.WorkspaceID, in.PageID, in.UserID)
	if err != nil {
		return false, err
	}
	if len(rows) == 0 {
		return false, nil
	}
	for _, row := range rows {
		if !domain.ResolvePagePermission(row.Facts).CanEdit {
			return false, nil
		}
	}
	return true, nil
}

const (
	SearchMatchFieldTitle = "title"
	SearchMatchFieldBody  = "body"
)

const searchExcerptWindowRunes = 30

type SearchViewablePageResult struct {
	Page       domain.Page
	MatchField string
	Excerpt    string
	MatchStart int
	MatchLen   int
}

type SearchViewablePagesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewSearchViewablePagesUseCase(r repository.KnowledgeBasePermissionRepository) *SearchViewablePagesUseCase {
	return &SearchViewablePagesUseCase{repo: r}
}

type SearchViewablePagesInput struct {
	WorkspaceID string
	UserID      uint64
	Query       string
	Limit       int
}

func (u *SearchViewablePagesUseCase) Execute(ctx context.Context, in SearchViewablePagesInput) ([]SearchViewablePageResult, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	query := strings.TrimSpace(in.Query)
	if query == "" {
		return nil, errors.New("query is required")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	rows, err := u.repo.SearchWorkspacePageViewFacts(ctx, in.WorkspaceID, in.UserID, query)
	if err != nil {
		return nil, err
	}
	results := make([]SearchViewablePageResult, 0, len(rows))
	for _, row := range rows {
		if !domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			continue
		}
		results = append(results, buildSearchViewablePageResult(row, query))
		if len(results) >= limit {
			break
		}
	}
	return results, nil
}

func buildSearchViewablePageResult(row repository.PageSearchViewFact, query string) SearchViewablePageResult {
	if strings.Contains(strings.ToLower(row.Page.Title), strings.ToLower(query)) {
		return SearchViewablePageResult{Page: row.Page, MatchField: SearchMatchFieldTitle}
	}
	excerpt, start, length, found := computeSearchExcerpt(row.Body, query)
	if !found {
		return SearchViewablePageResult{Page: row.Page, MatchField: SearchMatchFieldBody}
	}
	return SearchViewablePageResult{
		Page:       row.Page,
		MatchField: SearchMatchFieldBody,
		Excerpt:    excerpt,
		MatchStart: start,
		MatchLen:   length,
	}
}

func computeSearchExcerpt(body, query string) (excerpt string, start, length int, found bool) {
	lowerBody := strings.ToLower(body)
	lowerQuery := strings.ToLower(query)
	if lowerQuery == "" || lowerBody == "" {
		return "", 0, 0, false
	}
	byteIdx := strings.Index(lowerBody, lowerQuery)
	if byteIdx < 0 {
		return "", 0, 0, false
	}
	idx := utf8.RuneCountInString(lowerBody[:byteIdx])

	queryLen := utf8.RuneCountInString(lowerQuery)
	bodyRunes := []rune(body)
	winStart := idx - searchExcerptWindowRunes
	if winStart < 0 {
		winStart = 0
	}
	winEnd := idx + queryLen + searchExcerptWindowRunes
	if winEnd > len(bodyRunes) {
		winEnd = len(bodyRunes)
	}
	return string(bodyRunes[winStart:winEnd]), idx - winStart, queryLen, true
}

type ListPageBacklinksUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListPageBacklinksUseCase(r repository.KnowledgeBasePermissionRepository) *ListPageBacklinksUseCase {
	return &ListPageBacklinksUseCase{repo: r}
}

const listPageBacklinksMaxResults = 200

type ListPageBacklinksInput struct {
	WorkspaceID string
	UserID      uint64
	PageID      string
}

func (u *ListPageBacklinksUseCase) Execute(ctx context.Context, in ListPageBacklinksInput) ([]domain.Page, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if in.PageID == "" {
		return nil, errors.New("pageID is required")
	}
	rows, err := u.repo.ListPageLinkSourcePageViewFacts(ctx, in.WorkspaceID, in.UserID, in.PageID)
	if err != nil {
		return nil, err
	}
	pages := make([]domain.Page, 0, len(rows))
	for _, row := range rows {
		if !domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			continue
		}
		pages = append(pages, row.Page)
		if len(pages) >= listPageBacklinksMaxResults {
			break
		}
	}
	return pages, nil
}

type ListPagesReferencingTicketUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListPagesReferencingTicketUseCase(r repository.KnowledgeBasePermissionRepository) *ListPagesReferencingTicketUseCase {
	return &ListPagesReferencingTicketUseCase{repo: r}
}

type ListPagesReferencingTicketInput struct {
	WorkspaceID string
	UserID      uint64
	TicketID    string
}

func (u *ListPagesReferencingTicketUseCase) Execute(ctx context.Context, in ListPagesReferencingTicketInput) ([]domain.Page, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	rows, err := u.repo.ListPageTicketLinkSourcePageViewFacts(ctx, in.WorkspaceID, in.UserID, in.TicketID)
	if err != nil {
		return nil, err
	}
	pages := make([]domain.Page, 0, len(rows))
	for _, row := range rows {
		if !domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == in.UserID) {
			continue
		}
		pages = append(pages, row.Page)
		if len(pages) >= listPageBacklinksMaxResults {
			break
		}
	}
	return pages, nil
}

type CheckSpacePermissionUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCheckSpacePermissionUseCase(r repository.KnowledgeBasePermissionRepository) *CheckSpacePermissionUseCase {
	return &CheckSpacePermissionUseCase{repo: r}
}

type CheckSpacePermissionInput struct {
	WorkspaceID string
	SpaceID     string
	UserID      uint64
}

func (u *CheckSpacePermissionUseCase) Execute(ctx context.Context, in CheckSpacePermissionInput) (*domain.ScopePermission, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, repository.ErrSpaceNotFound
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.SpacePermissionFactsForUser(ctx, in.WorkspaceID, in.SpaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	perm := domain.ResolveScopePermission(*facts)
	return &perm, nil
}

type CheckWorkspacePermissionUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCheckWorkspacePermissionUseCase(r repository.KnowledgeBasePermissionRepository) *CheckWorkspacePermissionUseCase {
	return &CheckWorkspacePermissionUseCase{repo: r}
}

type CheckWorkspacePermissionInput struct {
	WorkspaceID string
	UserID      uint64
}

func (u *CheckWorkspacePermissionUseCase) Execute(ctx context.Context, in CheckWorkspacePermissionInput) (*domain.ScopePermission, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.WorkspacePermissionFactsForUser(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	perm := domain.ResolveScopePermission(*facts)
	return &perm, nil
}

type ListViewableSpacesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListViewableSpacesUseCase(r repository.KnowledgeBasePermissionRepository) *ListViewableSpacesUseCase {
	return &ListViewableSpacesUseCase{repo: r}
}

type ListViewableSpacesInput struct {
	WorkspaceID string
	UserID      uint64
}

func (u *ListViewableSpacesUseCase) Execute(ctx context.Context, in ListViewableSpacesInput) ([]domain.Space, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	rows, err := u.repo.ListWorkspaceSpaceScopeFacts(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Space, 0, len(rows))
	for _, row := range rows {
		if !domain.ResolveScopePermission(row.Facts).CanView {
			continue
		}
		out = append(out, row.Space)
	}
	return out, nil
}
