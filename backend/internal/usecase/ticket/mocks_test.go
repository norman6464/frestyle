package ticket_test

import (
	"context"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/mock"
)

// mockTicketRepo は repository.TicketRepository の testify/mock 実装。
// usecase/kb の mockKBPermissionRepo と同じ作法（各メソッドは Called → 型アサーション
// → 戻す、を機械的に繰り返すだけ。テストごとに使うメソッドだけ .On で期待値を設定する）。
type mockTicketRepo struct{ mock.Mock }

var _ repository.TicketRepository = (*mockTicketRepo)(nil)

func (m *mockTicketRepo) HasActiveInitialTicketStatus(ctx context.Context, workspaceID, projectID string) (bool, error) {
	args := m.Called(ctx, workspaceID, projectID)
	return args.Bool(0), args.Error(1)
}

func (m *mockTicketRepo) InsertTicketStatus(ctx context.Context, s *domain.TicketStatus) error {
	args := m.Called(ctx, s)
	return args.Error(0)
}

func (m *mockTicketRepo) FindTicketStatus(ctx context.Context, workspaceID, projectID, statusID string) (*domain.TicketStatus, error) {
	args := m.Called(ctx, workspaceID, projectID, statusID)
	s, _ := args.Get(0).(*domain.TicketStatus)
	return s, args.Error(1)
}

func (m *mockTicketRepo) ListTicketStatuses(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketStatus, error) {
	args := m.Called(ctx, workspaceID, projectID, includeArchived)
	s, _ := args.Get(0).([]domain.TicketStatus)
	return s, args.Error(1)
}

func (m *mockTicketRepo) GetInitialTicketStatus(ctx context.Context, workspaceID, projectID string) (*domain.TicketStatus, error) {
	args := m.Called(ctx, workspaceID, projectID)
	s, _ := args.Get(0).(*domain.TicketStatus)
	return s, args.Error(1)
}

func (m *mockTicketRepo) UpdateTicketStatus(ctx context.Context, s *domain.TicketStatus) error {
	args := m.Called(ctx, s)
	return args.Error(0)
}

func (m *mockTicketRepo) SetTicketStatusInitial(ctx context.Context, workspaceID, projectID, statusID string) error {
	args := m.Called(ctx, workspaceID, projectID, statusID)
	return args.Error(0)
}

func (m *mockTicketRepo) ArchiveTicketStatus(ctx context.Context, workspaceID, projectID, statusID string) error {
	args := m.Called(ctx, workspaceID, projectID, statusID)
	return args.Error(0)
}

func (m *mockTicketRepo) RestoreTicketStatus(ctx context.Context, workspaceID, projectID, statusID, position string) error {
	args := m.Called(ctx, workspaceID, projectID, statusID, position)
	return args.Error(0)
}

func (m *mockTicketRepo) CountActiveTicketsByStatus(ctx context.Context, workspaceID, projectID, statusID string) (int64, error) {
	args := m.Called(ctx, workspaceID, projectID, statusID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

func (m *mockTicketRepo) CountActiveTicketsByStatusForProject(ctx context.Context, workspaceID, projectID string) (map[string]int64, error) {
	args := m.Called(ctx, workspaceID, projectID)
	v, _ := args.Get(0).(map[string]int64)
	return v, args.Error(1)
}

func (m *mockTicketRepo) CountActiveTicketsByTypeForProject(ctx context.Context, workspaceID, projectID string) (map[string]int64, error) {
	args := m.Called(ctx, workspaceID, projectID)
	v, _ := args.Get(0).(map[string]int64)
	return v, args.Error(1)
}

func (m *mockTicketRepo) LastActiveTicketStatusPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	args := m.Called(ctx, workspaceID, projectID)
	return args.String(0), args.Error(1)
}

func (m *mockTicketRepo) InsertTicketType(ctx context.Context, t *domain.TicketType) error {
	args := m.Called(ctx, t)
	return args.Error(0)
}

func (m *mockTicketRepo) FindTicketType(ctx context.Context, workspaceID, projectID, typeID string) (*domain.TicketType, error) {
	args := m.Called(ctx, workspaceID, projectID, typeID)
	t, _ := args.Get(0).(*domain.TicketType)
	return t, args.Error(1)
}

func (m *mockTicketRepo) ListTicketTypes(ctx context.Context, workspaceID, projectID string, includeArchived bool) ([]domain.TicketType, error) {
	args := m.Called(ctx, workspaceID, projectID, includeArchived)
	t, _ := args.Get(0).([]domain.TicketType)
	return t, args.Error(1)
}

func (m *mockTicketRepo) GetDefaultTicketType(ctx context.Context, workspaceID, projectID string) (*domain.TicketType, error) {
	args := m.Called(ctx, workspaceID, projectID)
	t, _ := args.Get(0).(*domain.TicketType)
	return t, args.Error(1)
}

func (m *mockTicketRepo) UpdateTicketType(ctx context.Context, t *domain.TicketType) error {
	args := m.Called(ctx, t)
	return args.Error(0)
}

func (m *mockTicketRepo) SetTicketTypeDefault(ctx context.Context, workspaceID, projectID, typeID string) error {
	args := m.Called(ctx, workspaceID, projectID, typeID)
	return args.Error(0)
}

func (m *mockTicketRepo) ArchiveTicketType(ctx context.Context, workspaceID, projectID, typeID string) error {
	args := m.Called(ctx, workspaceID, projectID, typeID)
	return args.Error(0)
}

func (m *mockTicketRepo) RestoreTicketType(ctx context.Context, workspaceID, projectID, typeID, position string) error {
	args := m.Called(ctx, workspaceID, projectID, typeID, position)
	return args.Error(0)
}

func (m *mockTicketRepo) CountActiveTicketsByType(ctx context.Context, workspaceID, projectID, typeID string) (int64, error) {
	args := m.Called(ctx, workspaceID, projectID, typeID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

func (m *mockTicketRepo) LastActiveTicketTypePosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	args := m.Called(ctx, workspaceID, projectID)
	return args.String(0), args.Error(1)
}

func (m *mockTicketRepo) CreateTicket(ctx context.Context, in repository.TicketCreateInput) (*domain.Ticket, error) {
	args := m.Called(ctx, in)
	t, _ := args.Get(0).(*domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) FindTicket(ctx context.Context, workspaceID, ticketID string) (*domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	t, _ := args.Get(0).(*domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) FindTicketWithAssignee(ctx context.Context, workspaceID, ticketID string) (*repository.TicketWithAssignee, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	t, _ := args.Get(0).(*repository.TicketWithAssignee)
	return t, args.Error(1)
}

func (m *mockTicketRepo) FindTicketWorkspaceID(ctx context.Context, ticketID string) (string, error) {
	args := m.Called(ctx, ticketID)
	return args.String(0), args.Error(1)
}

func (m *mockTicketRepo) ResolveTicketIDByKey(ctx context.Context, workspaceID, projectKey string, number int64) (string, error) {
	args := m.Called(ctx, workspaceID, projectKey, number)
	return args.String(0), args.Error(1)
}

func (m *mockTicketRepo) ListTickets(ctx context.Context, in repository.ListTicketsInput) ([]repository.TicketWithAssignee, error) {
	args := m.Called(ctx, in)
	t, _ := args.Get(0).([]repository.TicketWithAssignee)
	return t, args.Error(1)
}

func (m *mockTicketRepo) GetTicketCounts(
	ctx context.Context, workspaceID, projectID string, myPrincipalID *string,
) (repository.TicketCounts, error) {
	args := m.Called(ctx, workspaceID, projectID, myPrincipalID)
	c, _ := args.Get(0).(repository.TicketCounts)
	return c, args.Error(1)
}

func (m *mockTicketRepo) ListTicketChildren(ctx context.Context, workspaceID, projectID, parentID string) ([]domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, projectID, parentID)
	t, _ := args.Get(0).([]domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) UpdateTicket(ctx context.Context, workspaceID, ticketID string, fields repository.TicketUpdateFields) (*domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, ticketID, fields)
	t, _ := args.Get(0).(*domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) ChangeTicketStatus(
	ctx context.Context, workspaceID, ticketID, statusID string,
	closedAt *time.Time, resolution *domain.TicketResolution,
) (*domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, ticketID, statusID, closedAt, resolution)
	t, _ := args.Get(0).(*domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) ArchiveTicket(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockTicketRepo) RestoreTicket(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockTicketRepo) DeleteTicket(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockTicketRepo) FindDeletedTicket(ctx context.Context, workspaceID, ticketID string) (*domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	t, _ := args.Get(0).(*domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) RestoreDeletedTicket(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockTicketRepo) InsertTicketRank(ctx context.Context, workspaceID, projectID, ticketID, position string) error {
	args := m.Called(ctx, workspaceID, projectID, ticketID, position)
	return args.Error(0)
}

func (m *mockTicketRepo) MoveTicketRank(ctx context.Context, workspaceID, ticketID, position string) error {
	args := m.Called(ctx, workspaceID, ticketID, position)
	return args.Error(0)
}

func (m *mockTicketRepo) UpsertTicketRank(ctx context.Context, workspaceID, projectID, ticketID, position string) error {
	args := m.Called(ctx, workspaceID, projectID, ticketID, position)
	return args.Error(0)
}

func (m *mockTicketRepo) LastTicketRankPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	args := m.Called(ctx, workspaceID, projectID)
	return args.String(0), args.Error(1)
}

func (m *mockTicketRepo) CountActiveTicketChildren(ctx context.Context, workspaceID, ticketID string) (int64, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

func (m *mockTicketRepo) ListTicketParentChain(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	t, _ := args.Get(0).([]domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) InsertTicketPathSelf(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockTicketRepo) InsertTicketPathAncestors(ctx context.Context, workspaceID, ticketID, parentID string) error {
	args := m.Called(ctx, workspaceID, ticketID, parentID)
	return args.Error(0)
}

func (m *mockTicketRepo) DetachTicketPathSubtree(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockTicketRepo) AttachTicketPathSubtree(ctx context.Context, workspaceID, ticketID, newParentID string) error {
	args := m.Called(ctx, workspaceID, ticketID, newParentID)
	return args.Error(0)
}

func (m *mockTicketRepo) ListTicketAncestors(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	t, _ := args.Get(0).([]domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) UpsertTicketAssignment(ctx context.Context, a *domain.TicketAssignment) error {
	args := m.Called(ctx, a)
	return args.Error(0)
}

func (m *mockTicketRepo) DeleteTicketAssignment(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockTicketRepo) FindTicketAssignment(ctx context.Context, workspaceID, ticketID string) (*domain.TicketAssignment, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	a, _ := args.Get(0).(*domain.TicketAssignment)
	return a, args.Error(1)
}

func (m *mockTicketRepo) ListTicketsAssignedToPrincipal(ctx context.Context, workspaceID, principalID string) ([]domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, principalID)
	t, _ := args.Get(0).([]domain.Ticket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) ListAssignedTickets(ctx context.Context, workspaceID, principalID string) ([]domain.AssignedTicket, error) {
	args := m.Called(ctx, workspaceID, principalID)
	t, _ := args.Get(0).([]domain.AssignedTicket)
	return t, args.Error(1)
}

func (m *mockTicketRepo) ListAssignedTicketsAcrossWorkspaces(
	ctx context.Context, userID uint64, workspaceIDs []string, limit int,
) ([]domain.AssignedTicketSummary, error) {
	args := m.Called(ctx, userID, workspaceIDs, limit)
	t, _ := args.Get(0).([]domain.AssignedTicketSummary)
	return t, args.Error(1)
}

func (m *mockTicketRepo) AddTicketWatcher(ctx context.Context, workspaceID, ticketID string, userID uint64) error {
	args := m.Called(ctx, workspaceID, ticketID, userID)
	return args.Error(0)
}

func (m *mockTicketRepo) RemoveTicketWatcher(ctx context.Context, workspaceID, ticketID string, userID uint64) error {
	args := m.Called(ctx, workspaceID, ticketID, userID)
	return args.Error(0)
}

func (m *mockTicketRepo) CountTicketWatchers(ctx context.Context, workspaceID, ticketID string) (int64, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

func (m *mockTicketRepo) IsTicketWatchedBy(ctx context.Context, workspaceID, ticketID string, userID uint64) (bool, error) {
	args := m.Called(ctx, workspaceID, ticketID, userID)
	return args.Bool(0), args.Error(1)
}

func (m *mockTicketRepo) InsertTicketChangeGroup(ctx context.Context, g *domain.TicketChangeGroup) error {
	args := m.Called(ctx, g)
	return args.Error(0)
}

func (m *mockTicketRepo) InsertTicketStatusTransition(
	ctx context.Context, workspaceID, projectID, ticketID, fromStatusID, toStatusID string, changedByUserID uint64,
) error {
	args := m.Called(ctx, workspaceID, projectID, ticketID, fromStatusID, toStatusID, changedByUserID)
	return args.Error(0)
}

func (m *mockTicketRepo) ListTicketChangeGroups(ctx context.Context, workspaceID, ticketID string) ([]domain.TicketChangeGroup, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	g, _ := args.Get(0).([]domain.TicketChangeGroup)
	return g, args.Error(1)
}

func (m *mockTicketRepo) ReplaceTicketPageLinks(ctx context.Context, workspaceID, sourceTicketID string, targetPageIDs []string) error {
	args := m.Called(ctx, workspaceID, sourceTicketID, targetPageIDs)
	return args.Error(0)
}

func (m *mockTicketRepo) ReplaceTicketTicketLinks(ctx context.Context, workspaceID, sourceTicketID string, targetTicketIDs []string) error {
	args := m.Called(ctx, workspaceID, sourceTicketID, targetTicketIDs)
	return args.Error(0)
}

func (m *mockTicketRepo) DeleteTicketPageLinksBySourceCascade(ctx context.Context, workspaceID, sourceTicketID string) error {
	args := m.Called(ctx, workspaceID, sourceTicketID)
	return args.Error(0)
}

func (m *mockTicketRepo) DeleteTicketTicketLinksBySourceCascade(ctx context.Context, workspaceID, sourceTicketID string) error {
	args := m.Called(ctx, workspaceID, sourceTicketID)
	return args.Error(0)
}

func (m *mockTicketRepo) ListTicketPageLinks(ctx context.Context, workspaceID, sourceTicketID string) ([]domain.TicketPageLink, error) {
	args := m.Called(ctx, workspaceID, sourceTicketID)
	l, _ := args.Get(0).([]domain.TicketPageLink)
	return l, args.Error(1)
}

func (m *mockTicketRepo) ListTicketsReferencingPage(
	ctx context.Context, workspaceID, pageID string, limit int,
) ([]domain.TicketReference, error) {
	args := m.Called(ctx, workspaceID, pageID, limit)
	t, _ := args.Get(0).([]domain.TicketReference)
	return t, args.Error(1)
}

func (m *mockTicketRepo) ListTicketTicketLinks(ctx context.Context, workspaceID, sourceTicketID string) ([]domain.TicketTicketLink, error) {
	args := m.Called(ctx, workspaceID, sourceTicketID)
	l, _ := args.Get(0).([]domain.TicketTicketLink)
	return l, args.Error(1)
}

func (m *mockTicketRepo) ListTicketsReferencingTicket(ctx context.Context, workspaceID, targetTicketID string) ([]domain.TicketTicketLink, error) {
	args := m.Called(ctx, workspaceID, targetTicketID)
	l, _ := args.Get(0).([]domain.TicketTicketLink)
	return l, args.Error(1)
}

// mockTicketCommentRepo は repository.TicketCommentRepository の testify/mock 実装。
type mockTicketCommentRepo struct{ mock.Mock }

var _ repository.TicketCommentRepository = (*mockTicketCommentRepo)(nil)

func (m *mockTicketCommentRepo) CreateTicketComment(ctx context.Context, c *domain.TicketComment) error {
	args := m.Called(ctx, c)
	return args.Error(0)
}

func (m *mockTicketCommentRepo) FindTicketComment(ctx context.Context, workspaceID, ticketID, commentID string) (*domain.TicketComment, error) {
	args := m.Called(ctx, workspaceID, ticketID, commentID)
	c, _ := args.Get(0).(*domain.TicketComment)
	return c, args.Error(1)
}

func (m *mockTicketCommentRepo) ListTicketComments(ctx context.Context, workspaceID, ticketID string) ([]domain.TicketComment, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	c, _ := args.Get(0).([]domain.TicketComment)
	return c, args.Error(1)
}

func (m *mockTicketCommentRepo) UpdateTicketCommentBody(ctx context.Context, workspaceID, ticketID, commentID, body string) (*domain.TicketComment, error) {
	args := m.Called(ctx, workspaceID, ticketID, commentID, body)
	c, _ := args.Get(0).(*domain.TicketComment)
	return c, args.Error(1)
}

func (m *mockTicketCommentRepo) DeleteTicketComment(ctx context.Context, workspaceID, ticketID, commentID string) error {
	args := m.Called(ctx, workspaceID, ticketID, commentID)
	return args.Error(0)
}

func (m *mockTicketCommentRepo) InsertTicketCommentEdit(ctx context.Context, e *domain.TicketCommentEdit) error {
	args := m.Called(ctx, e)
	return args.Error(0)
}

func (m *mockTicketCommentRepo) ListTicketCommentEdits(ctx context.Context, workspaceID, commentID string) ([]domain.TicketCommentEdit, error) {
	args := m.Called(ctx, workspaceID, commentID)
	e, _ := args.Get(0).([]domain.TicketCommentEdit)
	return e, args.Error(1)
}

func (m *mockTicketCommentRepo) AddTicketCommentReaction(ctx context.Context, workspaceID, commentID string, userID uint64, emoji string) error {
	args := m.Called(ctx, workspaceID, commentID, userID, emoji)
	return args.Error(0)
}

func (m *mockTicketCommentRepo) RemoveTicketCommentReaction(ctx context.Context, workspaceID, commentID string, userID uint64, emoji string) error {
	args := m.Called(ctx, workspaceID, commentID, userID, emoji)
	return args.Error(0)
}

func (m *mockTicketCommentRepo) ListTicketCommentReactions(ctx context.Context, workspaceID string, commentIDs []string) ([]domain.TicketCommentReaction, error) {
	args := m.Called(ctx, workspaceID, commentIDs)
	r, _ := args.Get(0).([]domain.TicketCommentReaction)
	return r, args.Error(1)
}

// mockNotificationRepo は repository.NotificationRepository の testify/mock 実装。
type mockNotificationRepo struct{ mock.Mock }

var _ repository.NotificationRepository = (*mockNotificationRepo)(nil)

func (m *mockNotificationRepo) Create(ctx context.Context, n *domain.Notification) error {
	args := m.Called(ctx, n)
	return args.Error(0)
}

func (m *mockNotificationRepo) CreateMany(ctx context.Context, ns []domain.Notification) error {
	args := m.Called(ctx, ns)
	return args.Error(0)
}

func (m *mockNotificationRepo) ListByUserID(ctx context.Context, userID uint64) ([]domain.Notification, error) {
	args := m.Called(ctx, userID)
	n, _ := args.Get(0).([]domain.Notification)
	return n, args.Error(1)
}

func (m *mockNotificationRepo) MarkRead(ctx context.Context, userID, id uint64) error {
	args := m.Called(ctx, userID, id)
	return args.Error(0)
}

func (m *mockNotificationRepo) MarkAllRead(ctx context.Context, userID uint64) error {
	args := m.Called(ctx, userID)
	return args.Error(0)
}

func (m *mockNotificationRepo) CountUnread(ctx context.Context, userID uint64) (int64, error) {
	args := m.Called(ctx, userID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

// mockKBPermissionRepo は repository.KnowledgeBasePermissionRepository の testify/mock 実装。
// usecase/ticket は権限判定をこちらに委ね（設計: SpacePermissionFactsForUser を再利用）、
// 独自の権限解決 SQL は持たない。フル実装は usecase/kb/mocks_test.go にあるが、
// 別パッケージ（ticket_test）からは参照できないためここに複製する。
type mockKBPermissionRepo struct{ mock.Mock }

var _ repository.KnowledgeBasePermissionRepository = (*mockKBPermissionRepo)(nil)

func (m *mockKBPermissionRepo) EnsureUserPrincipal(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, userID)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) EnsureSpaceEveryonePrincipal(ctx context.Context, workspaceID, projectID string) (*domain.Principal, error) {
	args := m.Called(ctx, workspaceID, projectID)
	p, _ := args.Get(0).(*domain.Principal)
	return p, args.Error(1)
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
	args := m.Called(ctx, workspaceID, principalID)
	return args.Error(0)
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

func (m *mockKBPermissionRepo) ListMemberWorkspaces(ctx context.Context, userID uint64) ([]repository.WorkspaceWithScopeFacts, error) {
	args := m.Called(ctx, userID)
	w, _ := args.Get(0).([]repository.WorkspaceWithScopeFacts)
	return w, args.Error(1)
}

func (m *mockKBPermissionRepo) LeaveWorkspaceMembership(ctx context.Context, workspaceID string, userID, actorUserID uint64) error {
	return m.Called(ctx, workspaceID, userID, actorUserID).Error(0)
}

func (m *mockKBPermissionRepo) AddGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error {
	args := m.Called(ctx, workspaceID, groupPrincipalID, memberPrincipalID)
	return args.Error(0)
}

func (m *mockKBPermissionRepo) RemoveGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error {
	args := m.Called(ctx, workspaceID, groupPrincipalID, memberPrincipalID)
	return args.Error(0)
}

func (m *mockKBPermissionRepo) UpsertWorkspaceGrant(
	ctx context.Context, workspaceID, principalID string, role domain.GrantRole, actorUserID uint64,
) (*domain.WorkspaceGrant, error) {
	args := m.Called(ctx, workspaceID, principalID, role, actorUserID)
	g, _ := args.Get(0).(*domain.WorkspaceGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) GrantWorkspaceRoleIfAbsent(ctx context.Context, workspaceID, principalID string, role domain.GrantRole) error {
	args := m.Called(ctx, workspaceID, principalID, role)
	return args.Error(0)
}

func (m *mockKBPermissionRepo) DeleteWorkspaceGrant(ctx context.Context, workspaceID, principalID string, actorUserID uint64) error {
	args := m.Called(ctx, workspaceID, principalID, actorUserID)
	return args.Error(0)
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
	g, _ := args.Get(0).([]domain.WorkspaceGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) UpsertSpaceGrant(ctx context.Context, workspaceID, projectID, principalID string, role domain.GrantRole) (*domain.SpaceGrant, error) {
	args := m.Called(ctx, workspaceID, projectID, principalID, role)
	g, _ := args.Get(0).(*domain.SpaceGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) DeleteSpaceGrant(ctx context.Context, workspaceID, projectID, principalID string) error {
	args := m.Called(ctx, workspaceID, projectID, principalID)
	return args.Error(0)
}

func (m *mockKBPermissionRepo) ListSpaceGrants(ctx context.Context, workspaceID, projectID string) ([]domain.SpaceGrant, error) {
	args := m.Called(ctx, workspaceID, projectID)
	g, _ := args.Get(0).([]domain.SpaceGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) UpsertPageGrant(ctx context.Context, workspaceID, pageID, principalID string, role domain.GrantRole) (*domain.PageGrant, error) {
	args := m.Called(ctx, workspaceID, pageID, principalID, role)
	g, _ := args.Get(0).(*domain.PageGrant)
	return g, args.Error(1)
}

func (m *mockKBPermissionRepo) DeletePageGrant(ctx context.Context, workspaceID, pageID, principalID string) error {
	args := m.Called(ctx, workspaceID, pageID, principalID)
	return args.Error(0)
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

func (m *mockKBPermissionRepo) ListSpaceMembers(ctx context.Context, workspaceID, projectID string) ([]domain.SpaceMember, error) {
	args := m.Called(ctx, workspaceID, projectID)
	p, _ := args.Get(0).([]domain.SpaceMember)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) ListMySpaces(ctx context.Context, workspaceID string, userID uint64) ([]domain.MySpace, error) {
	args := m.Called(ctx, workspaceID, userID)
	p, _ := args.Get(0).([]domain.MySpace)
	return p, args.Error(1)
}

func (m *mockKBPermissionRepo) ListPageGrants(ctx context.Context, workspaceID, pageID string) ([]domain.PageGrant, error) {
	args := m.Called(ctx, workspaceID, pageID)
	g, _ := args.Get(0).([]domain.PageGrant)
	return g, args.Error(1)
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

func (m *mockKBPermissionRepo) ListSpacePageViewFacts(ctx context.Context, workspaceID, projectID string, userID uint64, archived bool) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, projectID, userID, archived)
	f, _ := args.Get(0).([]repository.PageWithViewFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) SearchWorkspacePageViewFacts(ctx context.Context, workspaceID string, userID uint64, query string) ([]repository.PageSearchViewFact, error) {
	args := m.Called(ctx, workspaceID, userID, query)
	f, _ := args.Get(0).([]repository.PageSearchViewFact)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) ListPageLinkSourcePageViewFacts(ctx context.Context, workspaceID string, viewerUserID uint64, targetPageID string) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, viewerUserID, targetPageID)
	f, _ := args.Get(0).([]repository.PageWithViewFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) ListPageTicketLinkSourcePageViewFacts(ctx context.Context, workspaceID string, viewerUserID uint64, targetTicketID string) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, viewerUserID, targetTicketID)
	f, _ := args.Get(0).([]repository.PageWithViewFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) ListWorkspacePageViewFactsByIDs(ctx context.Context, workspaceID string, userID uint64, pageIDs []string) ([]repository.PageWithViewFacts, error) {
	args := m.Called(ctx, workspaceID, userID, pageIDs)
	f, _ := args.Get(0).([]repository.PageWithViewFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) SpacePermissionFactsForUser(ctx context.Context, workspaceID, projectID string, userID uint64) (*domain.ScopeFacts, error) {
	args := m.Called(ctx, workspaceID, projectID, userID)
	f, _ := args.Get(0).(*domain.ScopeFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) WorkspacePermissionFactsForUser(ctx context.Context, workspaceID string, userID uint64) (*domain.ScopeFacts, error) {
	args := m.Called(ctx, workspaceID, userID)
	f, _ := args.Get(0).(*domain.ScopeFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) ListWorkspaceSpaceScopeFacts(ctx context.Context, workspaceID string, userID uint64) ([]repository.SpaceWithScopeFacts, error) {
	args := m.Called(ctx, workspaceID, userID)
	f, _ := args.Get(0).([]repository.SpaceWithScopeFacts)
	return f, args.Error(1)
}

func (m *mockKBPermissionRepo) ListSubtreePagePermissionFacts(ctx context.Context, workspaceID, pageID string, userID uint64) ([]repository.PageWithPermissionFacts, error) {
	args := m.Called(ctx, workspaceID, pageID, userID)
	f, _ := args.Get(0).([]repository.PageWithPermissionFacts)
	return f, args.Error(1)
}

// mockLabelRepo は repository.LabelRepository の testify/mock 実装（段 4）。
type mockLabelRepo struct{ mock.Mock }

var _ repository.LabelRepository = (*mockLabelRepo)(nil)

func (m *mockLabelRepo) CreateLabel(ctx context.Context, l *domain.Label) error {
	args := m.Called(ctx, l)
	return args.Error(0)
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
	args := m.Called(ctx, l)
	return args.Error(0)
}

func (m *mockLabelRepo) DeleteLabel(ctx context.Context, workspaceID, labelID string) error {
	args := m.Called(ctx, workspaceID, labelID)
	return args.Error(0)
}

func (m *mockLabelRepo) AddTicketLabel(ctx context.Context, workspaceID, ticketID, labelID string) error {
	args := m.Called(ctx, workspaceID, ticketID, labelID)
	return args.Error(0)
}

func (m *mockLabelRepo) RemoveTicketLabel(ctx context.Context, workspaceID, ticketID, labelID string) error {
	args := m.Called(ctx, workspaceID, ticketID, labelID)
	return args.Error(0)
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
	args := m.Called(ctx, workspaceID, pageID, labelID)
	return args.Error(0)
}

func (m *mockLabelRepo) RemovePageLabel(ctx context.Context, workspaceID, pageID, labelID string) error {
	args := m.Called(ctx, workspaceID, pageID, labelID)
	return args.Error(0)
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

// mockTicketAttachmentRepo は repository.TicketAttachmentRepository の testify/mock 実装（段 4）。
type mockTicketAttachmentRepo struct{ mock.Mock }

var _ repository.TicketAttachmentRepository = (*mockTicketAttachmentRepo)(nil)

func (m *mockTicketAttachmentRepo) CreateTicketAttachment(ctx context.Context, a *domain.TicketAttachment) error {
	args := m.Called(ctx, a)
	return args.Error(0)
}

func (m *mockTicketAttachmentRepo) FindTicketAttachment(ctx context.Context, workspaceID, ticketID, attachmentID string) (*domain.TicketAttachment, error) {
	args := m.Called(ctx, workspaceID, ticketID, attachmentID)
	a, _ := args.Get(0).(*domain.TicketAttachment)
	return a, args.Error(1)
}

func (m *mockTicketAttachmentRepo) ListTicketAttachments(ctx context.Context, workspaceID, ticketID string) ([]domain.TicketAttachment, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	a, _ := args.Get(0).([]domain.TicketAttachment)
	return a, args.Error(1)
}

func (m *mockTicketAttachmentRepo) DeleteTicketAttachment(ctx context.Context, workspaceID, ticketID, attachmentID string) error {
	args := m.Called(ctx, workspaceID, ticketID, attachmentID)
	return args.Error(0)
}

// mockTicketAttachmentPresigner は repository.TicketAttachmentPresigner の testify/mock 実装。
type mockTicketAttachmentPresigner struct{ mock.Mock }

var _ repository.TicketAttachmentPresigner = (*mockTicketAttachmentPresigner)(nil)

func (m *mockTicketAttachmentPresigner) PresignUpload(ctx context.Context, key, contentType string, size int64) (string, int, error) {
	args := m.Called(ctx, key, contentType, size)
	return args.String(0), args.Int(1), args.Error(2)
}

func (m *mockTicketAttachmentPresigner) PresignDownload(ctx context.Context, key string) (string, int, error) {
	args := m.Called(ctx, key)
	return args.String(0), args.Int(1), args.Error(2)
}

func (m *mockTicketRepo) CountTickets(ctx context.Context, in repository.ListTicketsInput) (int64, error) {
	args := m.Called(ctx, in)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

// mockTicketSavedFilterRepo は repository.TicketSavedFilterRepository の testify/mock 実装。
type mockTicketSavedFilterRepo struct{ mock.Mock }

var _ repository.TicketSavedFilterRepository = (*mockTicketSavedFilterRepo)(nil)

func (m *mockTicketSavedFilterRepo) InsertTicketSavedFilter(ctx context.Context, f *domain.TicketSavedFilter) error {
	args := m.Called(ctx, f)
	return args.Error(0)
}

func (m *mockTicketSavedFilterRepo) UpdateTicketSavedFilter(ctx context.Context, f *domain.TicketSavedFilter) error {
	args := m.Called(ctx, f)
	return args.Error(0)
}

func (m *mockTicketSavedFilterRepo) DeleteTicketSavedFilter(ctx context.Context, workspaceID, projectID string, userID uint64, filterID string) error {
	args := m.Called(ctx, workspaceID, projectID, userID, filterID)
	return args.Error(0)
}

func (m *mockTicketSavedFilterRepo) ListTicketSavedFilters(ctx context.Context, workspaceID, projectID string, userID uint64) ([]domain.TicketSavedFilter, error) {
	args := m.Called(ctx, workspaceID, projectID, userID)
	l, _ := args.Get(0).([]domain.TicketSavedFilter)
	return l, args.Error(1)
}

func (m *mockTicketSavedFilterRepo) CountTicketSavedFilters(ctx context.Context, workspaceID, projectID string, userID uint64) (int64, error) {
	args := m.Called(ctx, workspaceID, projectID, userID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}
