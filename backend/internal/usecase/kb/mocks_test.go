package kb_test

import (
	"context"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/mock"
)

// usecase テストで共有する repository interface の testify/mock 実装。
// 1 interface = 1 定義に集約し、各テストファイルでの重複定義を禁止する
// (書き方の見本は send_ai_message_stream_usecase_test.go と同じ流儀)。

// --- mock: UserRepository ---

type mockUserRepo struct{ mock.Mock }

var _ repository.UserRepository = (*mockUserRepo)(nil)

func (m *mockUserRepo) FindByOidcSubject(ctx context.Context, sub string) (*domain.User, error) {
	args := m.Called(ctx, sub)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}

func (m *mockUserRepo) FindByID(ctx context.Context, id uint64) (*domain.User, error) {
	args := m.Called(ctx, id)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}

func (m *mockUserRepo) FindDisplayByID(ctx context.Context, id uint64) (*domain.UserDisplay, error) {
	args := m.Called(ctx, id)
	d, _ := args.Get(0).(*domain.UserDisplay)
	return d, args.Error(1)
}

func (m *mockUserRepo) Create(ctx context.Context, u *domain.User) error {
	return m.Called(ctx, u).Error(0)
}

func (m *mockUserRepo) OidcSubjectByUserID(ctx context.Context, userID uint64) (string, error) {
	args := m.Called(ctx, userID)
	return args.String(0), args.Error(1)
}

func (m *mockUserRepo) UpdateActive(ctx context.Context, userID uint64, active bool) error {
	return m.Called(ctx, userID, active).Error(0)
}

func (m *mockUserRepo) SoftDelete(ctx context.Context, userID uint64) error {
	return m.Called(ctx, userID).Error(0)
}

func (m *mockUserRepo) UpdateName(ctx context.Context, userID uint64, name string) error {
	return m.Called(ctx, userID, name).Error(0)
}

func (m *mockUserRepo) UpdateEmail(ctx context.Context, userID uint64, email string) error {
	return m.Called(ctx, userID, email).Error(0)
}

// --- mock: KnowledgeBaseRepository ---

type mockKnowledgeBaseRepo struct{ mock.Mock }

var _ repository.KnowledgeBaseRepository = (*mockKnowledgeBaseRepo)(nil)

func (m *mockKnowledgeBaseRepo) DeleteWorkspace(ctx context.Context, workspaceID string) error {
	args := m.Called(ctx, workspaceID)
	return args.Error(0)
}

func (m *mockKnowledgeBaseRepo) FindWorkspaceByID(ctx context.Context, workspaceID string) (*domain.Workspace, error) {
	args := m.Called(ctx, workspaceID)
	w, _ := args.Get(0).(*domain.Workspace)
	return w, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) FindWorkspaceBySlug(ctx context.Context, slug string) (*domain.Workspace, error) {
	args := m.Called(ctx, slug)
	w, _ := args.Get(0).(*domain.Workspace)
	return w, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) FindPersonalWorkspaceByOwner(ctx context.Context, userID uint64) (*domain.Workspace, error) {
	args := m.Called(ctx, userID)
	w, _ := args.Get(0).(*domain.Workspace)
	return w, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) FindSpace(ctx context.Context, workspaceID, spaceID string) (*domain.Space, error) {
	args := m.Called(ctx, workspaceID, spaceID)
	s, _ := args.Get(0).(*domain.Space)
	return s, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) CreateSpace(ctx context.Context, space *domain.Space) error {
	return m.Called(ctx, space).Error(0)
}

func (m *mockKnowledgeBaseRepo) UpdateSpaceName(ctx context.Context, workspaceID, spaceID, name string) error {
	return m.Called(ctx, workspaceID, spaceID, name).Error(0)
}

func (m *mockKnowledgeBaseRepo) DeletePageSubtree(ctx context.Context, workspaceID, pageID string) error {
	return m.Called(ctx, workspaceID, pageID).Error(0)
}

func (m *mockKnowledgeBaseRepo) ListAncestorPageIDs(ctx context.Context, workspaceID, pageID string) ([]string, error) {
	args := m.Called(ctx, workspaceID, pageID)
	ids, _ := args.Get(0).([]string)
	return ids, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) FindPageByIDAcrossWorkspaces(ctx context.Context, pageID string) (*domain.Page, error) {
	args := m.Called(ctx, pageID)
	p, _ := args.Get(0).(*domain.Page)
	return p, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) FindPage(ctx context.Context, workspaceID, pageID string) (*domain.Page, error) {
	args := m.Called(ctx, workspaceID, pageID)
	p, _ := args.Get(0).(*domain.Page)
	return p, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) ListActivePagesBySpace(ctx context.Context, workspaceID, spaceID string) ([]domain.Page, error) {
	args := m.Called(ctx, workspaceID, spaceID)
	rows, _ := args.Get(0).([]domain.Page)
	return rows, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) ListAllWorkspaceIDs(ctx context.Context) ([]string, error) {
	args := m.Called(ctx)
	ids, _ := args.Get(0).([]string)
	return ids, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) ListActivePageIDsByWorkspace(ctx context.Context, workspaceID string) ([]string, error) {
	args := m.Called(ctx, workspaceID)
	ids, _ := args.Get(0).([]string)
	return ids, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) SiblingPositionsAround(
	ctx context.Context, workspaceID, spaceID string, parentID *string, anchorPageID, movingPageID string,
) (bool, string, string, string, error) {
	args := m.Called(ctx, workspaceID, spaceID, parentID, anchorPageID, movingPageID)
	return args.Bool(0), args.String(1), args.String(2), args.String(3), args.Error(4)
}

func (m *mockKnowledgeBaseRepo) LastActiveSiblingPosition(ctx context.Context, workspaceID, spaceID string, parentID *string) (string, error) {
	args := m.Called(ctx, workspaceID, spaceID, parentID)
	return args.String(0), args.Error(1)
}

func (m *mockKnowledgeBaseRepo) HasActiveSiblingPosition(ctx context.Context, workspaceID, spaceID string, parentID *string, position, excludePageID string) (bool, error) {
	args := m.Called(ctx, workspaceID, spaceID, parentID, position, excludePageID)
	return args.Bool(0), args.Error(1)
}

func (m *mockKnowledgeBaseRepo) HasDescendant(ctx context.Context, workspaceID, pageID, candidateID string) (bool, error) {
	args := m.Called(ctx, workspaceID, pageID, candidateID)
	return args.Bool(0), args.Error(1)
}

func (m *mockKnowledgeBaseRepo) CreatePage(ctx context.Context, page *domain.Page) error {
	return m.Called(ctx, page).Error(0)
}

func (m *mockKnowledgeBaseRepo) UpdatePageTitle(ctx context.Context, workspaceID, pageID, title string) (*domain.Page, error) {
	args := m.Called(ctx, workspaceID, pageID, title)
	p, _ := args.Get(0).(*domain.Page)
	return p, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) UpdatePageIcon(ctx context.Context, workspaceID, pageID string, icon *domain.PageIcon) (*domain.Page, error) {
	args := m.Called(ctx, workspaceID, pageID, icon)
	p, _ := args.Get(0).(*domain.Page)
	return p, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) UpdatePageCover(ctx context.Context, workspaceID, pageID string, cover *domain.PageCover) (*domain.Page, error) {
	args := m.Called(ctx, workspaceID, pageID, cover)
	p, _ := args.Get(0).(*domain.Page)
	return p, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) UpdatePageVisibility(ctx context.Context, workspaceID, pageID string, visibility domain.PageVisibility) (*domain.Page, error) {
	args := m.Called(ctx, workspaceID, pageID, visibility)
	p, _ := args.Get(0).(*domain.Page)
	return p, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) TouchPageLastEditedBy(ctx context.Context, workspaceID, pageID string, userID uint64) error {
	return m.Called(ctx, workspaceID, pageID, userID).Error(0)
}

func (m *mockKnowledgeBaseRepo) MovePage(ctx context.Context, workspaceID, pageID string, newParentID *string, newSpaceID, newPosition string) error {
	return m.Called(ctx, workspaceID, pageID, newParentID, newSpaceID, newPosition).Error(0)
}

func (m *mockKnowledgeBaseRepo) ArchivePageSubtree(ctx context.Context, workspaceID, pageID string) error {
	return m.Called(ctx, workspaceID, pageID).Error(0)
}

func (m *mockKnowledgeBaseRepo) UnarchivePageSubtree(ctx context.Context, workspaceID, pageID string, archivedSince time.Time, newRootPosition *string) error {
	return m.Called(ctx, workspaceID, pageID, archivedSince, newRootPosition).Error(0)
}

func (m *mockKnowledgeBaseRepo) ListBlocksByPage(ctx context.Context, workspaceID, pageID string) ([]domain.Block, error) {
	args := m.Called(ctx, workspaceID, pageID)
	rows, _ := args.Get(0).([]domain.Block)
	return rows, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) ReplacePageBlocks(
	ctx context.Context, workspaceID, pageID string, blocks []repository.BlockWrite, snapshotDoc, title, body string,
	pageLinks []repository.PageLinkWrite, pageTicketLinks []repository.PageTicketLinkWrite,
) error {
	return m.Called(ctx, workspaceID, pageID, blocks, snapshotDoc, title, body, pageLinks, pageTicketLinks).Error(0)
}

func (m *mockKnowledgeBaseRepo) GetPageSnapshot(ctx context.Context, workspaceID, pageID string) (*domain.PageSnapshot, error) {
	args := m.Called(ctx, workspaceID, pageID)
	s, _ := args.Get(0).(*domain.PageSnapshot)
	return s, args.Error(1)
}

func (m *mockKnowledgeBaseRepo) RebuildPageSearchAndLinks(ctx context.Context, workspaceID, pageID string) error {
	return m.Called(ctx, workspaceID, pageID).Error(0)
}

// --- mock: KnowledgeBasePermissionRepository ---

type mockKBPermissionRepo struct{ mock.Mock }

var _ repository.KnowledgeBasePermissionRepository = (*mockKBPermissionRepo)(nil)

func (m *mockKBPermissionRepo) EnsureUserPrincipal(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, userID)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) EnsureSpaceEveryonePrincipal(ctx context.Context, workspaceID, spaceID string) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, spaceID)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) ListMemberWorkspaces(ctx context.Context, userID uint64) ([]domain.MemberWorkspace, error) {
	args := m.Called(ctx, userID)
	rows, _ := args.Get(0).([]domain.MemberWorkspace)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) SpacePermissionFactsForUser(ctx context.Context, workspaceID, spaceID string, userID uint64) (*domain.ScopeFacts, error) {
	args := m.Called(ctx, workspaceID, spaceID, userID)
	f, _ := args.Get(0).(*domain.ScopeFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) WorkspacePermissionFactsForUser(ctx context.Context, workspaceID string, userID uint64) (*domain.ScopeFacts, error) {
	args := m.Called(ctx, workspaceID, userID)
	f, _ := args.Get(0).(*domain.ScopeFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) CreateGroupPrincipal(ctx context.Context, workspaceID, name string) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, name)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) FindPrincipal(ctx context.Context, workspaceID, principalID string) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, principalID)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) FindUserPrincipal(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, userID)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) DeletePrincipal(ctx context.Context, workspaceID, principalID string) error {
	return m.Called(ctx, workspaceID, principalID).Error(0)
}

func (m *mockKBPermissionRepo) IsWorkspaceMember(ctx context.Context, workspaceID string, userID uint64) (bool, error) {
	args := m.Called(ctx, workspaceID, userID)
	return args.Bool(0), args.Error(1)
}

func (m *mockKBPermissionRepo) IsWorkspaceMemberBulk(ctx context.Context, workspaceID string, userIDs []uint64) (map[uint64]bool, error) {
	args := m.Called(ctx, workspaceID, userIDs)
	out, _ := args.Get(0).(map[uint64]bool)
	return out, args.Error(1)
}

func (m *mockKBPermissionRepo) InviteWorkspaceMember(ctx context.Context, workspaceID string, userID, invitedByUserID uint64) error {
	return m.Called(ctx, workspaceID, userID, invitedByUserID).Error(0)
}

func (m *mockKBPermissionRepo) AcceptWorkspaceInvitation(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, userID)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) DeclineWorkspaceInvitation(ctx context.Context, workspaceID string, userID uint64) error {
	return m.Called(ctx, workspaceID, userID).Error(0)
}

func (m *mockKBPermissionRepo) ListMyWorkspaceInvitations(ctx context.Context, userID uint64) ([]domain.WorkspaceInvitation, error) {
	args := m.Called(ctx, userID)
	rows, _ := args.Get(0).([]domain.WorkspaceInvitation)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) LeaveWorkspaceMembership(ctx context.Context, workspaceID string, userID, actorUserID uint64) error {
	return m.Called(ctx, workspaceID, userID, actorUserID).Error(0)
}

func (m *mockKBPermissionRepo) AddGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error {
	return m.Called(ctx, workspaceID, groupPrincipalID, memberPrincipalID).Error(0)
}

func (m *mockKBPermissionRepo) RemoveGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error {
	return m.Called(ctx, workspaceID, groupPrincipalID, memberPrincipalID).Error(0)
}

func (m *mockKBPermissionRepo) UpsertWorkspaceGrant(
	ctx context.Context, workspaceID, principalID string, role domain.GrantRole, actorUserID uint64,
) (*domain.WorkspaceGrant, error) {
	args := m.Called(ctx, workspaceID, principalID, role, actorUserID)
	g, _ := args.Get(0).(*domain.WorkspaceGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) DeleteWorkspaceGrant(ctx context.Context, workspaceID, principalID string, actorUserID uint64) error {
	return m.Called(ctx, workspaceID, principalID, actorUserID).Error(0)
}

func (m *mockKBPermissionRepo) ListMembershipEvents(ctx context.Context, workspaceID string) ([]domain.MembershipEvent, error) {
	args := m.Called(ctx, workspaceID)
	rows, _ := args.Get(0).([]domain.MembershipEvent)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) RecordMembershipEvent(
	ctx context.Context, workspaceID string, targetUserID, actorUserID uint64,
	action domain.MembershipEventAction, oldLabel, newLabel *string,
) error {
	return m.Called(ctx, workspaceID, targetUserID, actorUserID, action, oldLabel, newLabel).Error(0)
}

func (m *mockKBPermissionRepo) ListWorkspaceGrants(ctx context.Context, workspaceID string) ([]domain.WorkspaceGrant, error) {
	args := m.Called(ctx, workspaceID)
	rows, _ := args.Get(0).([]domain.WorkspaceGrant)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) ListGrantablePrincipals(ctx context.Context, workspaceID string) ([]domain.GrantablePrincipal, error) {
	args := m.Called(ctx, workspaceID)
	p, _ := args.Get(0).([]domain.GrantablePrincipal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) ListWorkspaceMembers(ctx context.Context, workspaceID string) ([]domain.WorkspaceMember, error) {
	args := m.Called(ctx, workspaceID)
	p, _ := args.Get(0).([]domain.WorkspaceMember)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) ListWorkspaceMembersForAdmin(ctx context.Context, workspaceID string) ([]domain.AdminWorkspaceMember, error) {
	args := m.Called(ctx, workspaceID)
	p, _ := args.Get(0).([]domain.AdminWorkspaceMember)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) UpsertPageGrant(ctx context.Context, workspaceID, pageID, principalID string, role domain.GrantRole) (*domain.PageGrant, error) {
	args := m.Called(ctx, workspaceID, pageID, principalID, role)
	g, _ := args.Get(0).(*domain.PageGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) ListSpaceMembers(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceMember, error) {
	args := m.Called(ctx, workspaceID, spaceID)
	p, _ := args.Get(0).([]domain.SpaceMember)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) ListMySpaces(ctx context.Context, workspaceID string, userID uint64) ([]domain.MySpace, error) {
	args := m.Called(ctx, workspaceID, userID)
	p, _ := args.Get(0).([]domain.MySpace)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) DeletePageGrant(ctx context.Context, workspaceID, pageID, principalID string) error {
	args := m.Called(ctx, workspaceID, pageID, principalID)
	return args.Error(0)
}

func (m *mockKBPermissionRepo) ListPageGrants(ctx context.Context, workspaceID, pageID string) ([]domain.PageGrant, error) {
	args := m.Called(ctx, workspaceID, pageID)
	g, _ := args.Get(0).([]domain.PageGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) UpsertSpaceGrant(ctx context.Context, workspaceID, spaceID, principalID string, role domain.GrantRole) (*domain.SpaceGrant, error) {
	args := m.Called(ctx, workspaceID, spaceID, principalID, role)
	g, _ := args.Get(0).(*domain.SpaceGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) DeleteSpaceGrant(ctx context.Context, workspaceID, spaceID, principalID string) error {
	return m.Called(ctx, workspaceID, spaceID, principalID).Error(0)
}

func (m *mockKBPermissionRepo) ListSpaceGrants(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceGrant, error) {
	args := m.Called(ctx, workspaceID, spaceID)
	rows, _ := args.Get(0).([]domain.SpaceGrant)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) PagePermissionFactsForUser(ctx context.Context, workspaceID, pageID string, userID uint64) (*domain.PagePermissionFacts, error) {
	args := m.Called(ctx, workspaceID, pageID, userID)
	f, _ := args.Get(0).(*domain.PagePermissionFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) PagePermissionFactsForPrincipal(ctx context.Context, workspaceID, pageID, principalID string) (*domain.PagePermissionFacts, error) {
	args := m.Called(ctx, workspaceID, pageID, principalID)
	f, _ := args.Get(0).(*domain.PagePermissionFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) SearchWorkspacePageViewFacts(ctx context.Context, workspaceID string, userID uint64, query string) ([]repository.PageSearchViewFact, error) {
	args := m.Called(ctx, workspaceID, userID, query)
	rows, _ := args.Get(0).([]repository.PageSearchViewFact)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) ListPageLinkSourcePageViewFacts(
	ctx context.Context, workspaceID string, viewerUserID uint64, targetPageID string,
) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, viewerUserID, targetPageID)
	rows, _ := args.Get(0).([]repository.PageWithViewFacts)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) ListPageTicketLinkSourcePageViewFacts(
	ctx context.Context, workspaceID string, viewerUserID uint64, targetTicketID string,
) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, viewerUserID, targetTicketID)
	rows, _ := args.Get(0).([]repository.PageWithViewFacts)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) ListWorkspacePageViewFactsByIDs(ctx context.Context, workspaceID string, userID uint64, pageIDs []string) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, userID, pageIDs)
	rows, _ := args.Get(0).([]repository.PageWithViewFacts)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) GrantWorkspaceRoleIfAbsent(ctx context.Context, workspaceID, principalID string, role domain.GrantRole) error {
	return m.Called(ctx, workspaceID, principalID, role).Error(0)
}

func (m *mockKBPermissionRepo) ListSpacePageViewFacts(ctx context.Context, workspaceID, spaceID string, userID uint64, archived bool) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, spaceID, userID, archived)
	rows, _ := args.Get(0).([]repository.PageWithViewFacts)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) ListWorkspaceSpaceScopeFacts(ctx context.Context, workspaceID string, userID uint64) ([]repository.SpaceWithScopeFacts, error) {
	args := m.Called(ctx, workspaceID, userID)
	rows, _ := args.Get(0).([]repository.SpaceWithScopeFacts)
	return rows, args.Error(1)
}

func (m *mockKBPermissionRepo) ListSubtreePagePermissionFacts(ctx context.Context, workspaceID, pageID string, userID uint64) ([]repository.PageWithPermissionFacts, error) {
	args := m.Called(ctx, workspaceID, pageID, userID)
	rows, _ := args.Get(0).([]repository.PageWithPermissionFacts)
	return rows, args.Error(1)
}

type mockShareLinkRepo struct{ mock.Mock }

var _ repository.ShareLinkRepository = (*mockShareLinkRepo)(nil)

func (m *mockShareLinkRepo) Create(ctx context.Context, in repository.ShareLinkWrite) (*domain.ShareLink, error) {
	args := m.Called(ctx, in)
	l, _ := args.Get(0).(*domain.ShareLink)
	return l, args.Error(1)
}

func (m *mockShareLinkRepo) Revoke(ctx context.Context, workspaceID, shareLinkID string) error {
	return m.Called(ctx, workspaceID, shareLinkID).Error(0)
}

func (m *mockShareLinkRepo) FindByTokenHash(ctx context.Context, tokenHash []byte) (*domain.ShareLink, error) {
	args := m.Called(ctx, tokenHash)
	l, _ := args.Get(0).(*domain.ShareLink)
	return l, args.Error(1)
}

func (m *mockShareLinkRepo) ListByPage(ctx context.Context, workspaceID, pageID string) ([]domain.ShareLink, error) {
	args := m.Called(ctx, workspaceID, pageID)
	rows, _ := args.Get(0).([]domain.ShareLink)
	return rows, args.Error(1)
}

// --- fake: TxManager ---

// txMarkerKey は fakeTxManager が DoInTx の中で ctx に埋め込む印。
// 本物の *sql.Tx を持たないテストで「repository がトランザクションの中で呼ばれたか」を
// mock.MatchedBy(inTx) で確かめられるようにするためだけの値。
type txMarkerKeyType struct{}

var txMarkerKey = txMarkerKeyType{}

// inTx は mock.MatchedBy に渡す述語。ctx に txMarkerKey が乗っていれば
// fakeTxManager.DoInTx の fn の中（＝トランザクションの中）から呼ばれたことを意味する。
func inTx(ctx context.Context) bool {
	v, _ := ctx.Value(txMarkerKey).(bool)
	return v
}

// fakeTxManager は repository.TxManager のテスト用実装。実 DB もトランザクションも
// 介さず fn(ctx) をそのまま呼ぶが、呼び出し回数と「tx の中で呼んだ」印だけは残す。
type fakeTxManager struct {
	calls int
}

var _ repository.TxManager = (*fakeTxManager)(nil)

func (f *fakeTxManager) DoInTx(ctx context.Context, fn func(context.Context) error) error {
	f.calls++
	return fn(context.WithValue(ctx, txMarkerKey, true))
}

// --- mock: KbImagePresigner ---

type mockKbImagePresigner struct{ mock.Mock }

var _ repository.KbImagePresigner = (*mockKbImagePresigner)(nil)

func (m *mockKbImagePresigner) PresignUpload(ctx context.Context, key, contentType string, size int64) (string, int, error) {
	args := m.Called(ctx, key, contentType, size)
	return args.String(0), args.Int(1), args.Error(2)
}

func (m *mockKbImagePresigner) PresignDownload(ctx context.Context, key string) (string, int, error) {
	args := m.Called(ctx, key)
	return args.String(0), args.Int(1), args.Error(2)
}

// --- mock: PageVersionRepository ---

type mockPageVersionRepo struct{ mock.Mock }

var _ repository.PageVersionRepository = (*mockPageVersionRepo)(nil)

func (m *mockPageVersionRepo) LockPage(ctx context.Context, workspaceID, pageID string) error {
	args := m.Called(ctx, workspaceID, pageID)
	return args.Error(0)
}

func (m *mockPageVersionRepo) CreateVersionIfDue(
	ctx context.Context, workspaceID, pageID, doc string, authorUserID uint64, note *string, force bool,
) (bool, *domain.PageVersion, error) {
	args := m.Called(ctx, workspaceID, pageID, doc, authorUserID, note, force)
	var v *domain.PageVersion
	if args.Get(1) != nil {
		v = args.Get(1).(*domain.PageVersion)
	}
	return args.Bool(0), v, args.Error(2)
}

func (m *mockPageVersionRepo) ListVersions(ctx context.Context, workspaceID, pageID string) ([]domain.PageVersion, error) {
	args := m.Called(ctx, workspaceID, pageID)
	var v []domain.PageVersion
	if args.Get(0) != nil {
		v = args.Get(0).([]domain.PageVersion)
	}
	return v, args.Error(1)
}

func (m *mockPageVersionRepo) GetVersion(ctx context.Context, workspaceID, pageID string, seq int64) (*domain.PageVersion, error) {
	args := m.Called(ctx, workspaceID, pageID, seq)
	var v *domain.PageVersion
	if args.Get(0) != nil {
		v = args.Get(0).(*domain.PageVersion)
	}
	return v, args.Error(1)
}

func (m *mockPageVersionRepo) GetLatestVersion(ctx context.Context, workspaceID, pageID string) (*domain.PageVersion, error) {
	args := m.Called(ctx, workspaceID, pageID)
	var v *domain.PageVersion
	if args.Get(0) != nil {
		v = args.Get(0).(*domain.PageVersion)
	}
	return v, args.Error(1)
}

// --- mock: PageTemplateRepository ---

type mockPageTemplateRepo struct{ mock.Mock }

var _ repository.PageTemplateRepository = (*mockPageTemplateRepo)(nil)

func (m *mockPageTemplateRepo) Create(ctx context.Context, tpl *domain.PageTemplate) error {
	return m.Called(ctx, tpl).Error(0)
}

func (m *mockPageTemplateRepo) List(ctx context.Context, workspaceID string, spaceID *string) ([]domain.PageTemplate, error) {
	args := m.Called(ctx, workspaceID, spaceID)
	rows, _ := args.Get(0).([]domain.PageTemplate)
	return rows, args.Error(1)
}

func (m *mockPageTemplateRepo) Get(ctx context.Context, workspaceID, templateID string) (*domain.PageTemplate, error) {
	args := m.Called(ctx, workspaceID, templateID)
	tpl, _ := args.Get(0).(*domain.PageTemplate)
	return tpl, args.Error(1)
}

func (m *mockPageTemplateRepo) Delete(ctx context.Context, workspaceID, templateID string) error {
	return m.Called(ctx, workspaceID, templateID).Error(0)
}

// --- mock: PageSuggestionRepository ---

type mockPageSuggestionRepo struct{ mock.Mock }

var _ repository.PageSuggestionRepository = (*mockPageSuggestionRepo)(nil)

func (m *mockPageSuggestionRepo) Create(ctx context.Context, s *domain.PageSuggestion) error {
	return m.Called(ctx, s).Error(0)
}

func (m *mockPageSuggestionRepo) ListOpen(ctx context.Context, workspaceID, pageID string, limit int) ([]domain.PageSuggestion, error) {
	args := m.Called(ctx, workspaceID, pageID, limit)
	rows, _ := args.Get(0).([]domain.PageSuggestion)
	return rows, args.Error(1)
}

func (m *mockPageSuggestionRepo) CountOpen(ctx context.Context, workspaceID, pageID string) (int, error) {
	args := m.Called(ctx, workspaceID, pageID)
	count, _ := args.Get(0).(int)
	return count, args.Error(1)
}

func (m *mockPageSuggestionRepo) CountOpenByAuthor(ctx context.Context, workspaceID, pageID string, authorUserID uint64) (int, error) {
	args := m.Called(ctx, workspaceID, pageID, authorUserID)
	count, _ := args.Get(0).(int)
	return count, args.Error(1)
}

func (m *mockPageSuggestionRepo) Get(ctx context.Context, workspaceID, pageID, suggestionID string) (*domain.PageSuggestion, error) {
	args := m.Called(ctx, workspaceID, pageID, suggestionID)
	s, _ := args.Get(0).(*domain.PageSuggestion)
	return s, args.Error(1)
}

func (m *mockPageSuggestionRepo) Resolve(
	ctx context.Context, workspaceID, pageID, suggestionID string,
	status domain.PageSuggestionStatus, resolverUserID uint64, resolvedAt time.Time,
) (*domain.PageSuggestion, error) {
	args := m.Called(ctx, workspaceID, pageID, suggestionID, status, resolverUserID, resolvedAt)
	s, _ := args.Get(0).(*domain.PageSuggestion)
	return s, args.Error(1)
}

// mockLabelRepo は repository.LabelRepository の testify/mock 実装（段13。ページへの
// ラベル付け外しのテストに使う。チケット側のメソッドは呼ばれない前提でスタブのみ用意する）。
type mockLabelRepo struct{ mock.Mock }

var _ repository.LabelRepository = (*mockLabelRepo)(nil)

func (m *mockLabelRepo) CreateLabel(ctx context.Context, l *domain.Label) error {
	return m.Called(ctx, l).Error(0)
}

func (m *mockLabelRepo) FindLabel(ctx context.Context, workspaceID, labelID string) (*domain.Label, error) {
	args := m.Called(ctx, workspaceID, labelID)
	l, _ := args.Get(0).(*domain.Label)
	return l, args.Error(1)
}

func (m *mockLabelRepo) ListLabels(ctx context.Context, workspaceID string) ([]domain.Label, error) {
	args := m.Called(ctx, workspaceID)
	l, _ := args.Get(0).([]domain.Label)
	return l, args.Error(1)
}

func (m *mockLabelRepo) UpdateLabel(ctx context.Context, l *domain.Label) error {
	return m.Called(ctx, l).Error(0)
}

func (m *mockLabelRepo) DeleteLabel(ctx context.Context, workspaceID, labelID string) error {
	return m.Called(ctx, workspaceID, labelID).Error(0)
}

func (m *mockLabelRepo) AddTicketLabel(ctx context.Context, workspaceID, ticketID, labelID string) error {
	return m.Called(ctx, workspaceID, ticketID, labelID).Error(0)
}

func (m *mockLabelRepo) RemoveTicketLabel(ctx context.Context, workspaceID, ticketID, labelID string) error {
	return m.Called(ctx, workspaceID, ticketID, labelID).Error(0)
}

func (m *mockLabelRepo) ListLabelsByTicket(ctx context.Context, workspaceID, ticketID string) ([]domain.Label, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	l, _ := args.Get(0).([]domain.Label)
	return l, args.Error(1)
}

func (m *mockLabelRepo) ListLabelsByTicketIDs(ctx context.Context, workspaceID string, ticketIDs []string) (map[string][]domain.Label, error) {
	args := m.Called(ctx, workspaceID, ticketIDs)
	l, _ := args.Get(0).(map[string][]domain.Label)
	return l, args.Error(1)
}

func (m *mockLabelRepo) AddPageLabel(ctx context.Context, workspaceID, pageID, labelID string) error {
	return m.Called(ctx, workspaceID, pageID, labelID).Error(0)
}

func (m *mockLabelRepo) RemovePageLabel(ctx context.Context, workspaceID, pageID, labelID string) error {
	return m.Called(ctx, workspaceID, pageID, labelID).Error(0)
}

func (m *mockLabelRepo) ListLabelsByPage(ctx context.Context, workspaceID, pageID string) ([]domain.Label, error) {
	args := m.Called(ctx, workspaceID, pageID)
	l, _ := args.Get(0).([]domain.Label)
	return l, args.Error(1)
}

func (m *mockLabelRepo) ListLabelsByPageIDs(ctx context.Context, workspaceID string, pageIDs []string) (map[string][]domain.Label, error) {
	args := m.Called(ctx, workspaceID, pageIDs)
	l, _ := args.Get(0).(map[string][]domain.Label)
	return l, args.Error(1)
}
