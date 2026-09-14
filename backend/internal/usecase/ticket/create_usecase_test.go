package ticket_test

import (
	"context"
	"errors"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const tkParentConst = "01a00000-0000-7000-8000-000000000010"

var tkParent = tkParentConst

func tkDefaultType() domain.TicketType {
	return domain.TicketType{ID: "01a00000-0000-7000-8000-000000000020", WorkspaceID: tkWS, ProjectID: tkProject, Name: "タスク", HierarchyLevel: 0, IsDefault: true}
}

func tkInitialStatus() domain.TicketStatus {
	return domain.TicketStatus{ID: "01a00000-0000-7000-8000-000000000030", WorkspaceID: tkWS, ProjectID: tkProject, Name: "To Do", Category: domain.TicketStatusCategoryTodo, IsInitial: true}
}

func Test_チケット作成_必須項目の検証(t *testing.T) {
	uc := ticket.NewCreateTicketUseCase(&mockTicketRepo{}, fakeTxManager{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, ticket.CreateTicketInput{ProjectID: tkProject, Title: "x", CreatedByUserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, ticket.CreateTicketInput{WorkspaceID: tkWS, Title: "x", CreatedByUserID: 1})
	require.Error(t, err, "projectID 必須")
	_, err = uc.Execute(ctx, ticket.CreateTicketInput{WorkspaceID: tkWS, ProjectID: tkProject, CreatedByUserID: 1})
	require.ErrorIs(t, err, domain.ErrInvalidTicketName, "title 必須")
	_, err = uc.Execute(ctx, ticket.CreateTicketInput{WorkspaceID: tkWS, ProjectID: tkProject, Title: "  "})
	require.ErrorIs(t, err, domain.ErrInvalidTicketName, "空白だけの title は拒否")
	_, err = uc.Execute(ctx, ticket.CreateTicketInput{WorkspaceID: tkWS, ProjectID: tkProject, Title: "x"})
	require.Error(t, err, "createdByUserID 必須")
}

// 開始日が期限より後なら、DB の CHECK（ck_tickets_dates_ordered）に到達させず
// ここで断る（素の Postgres エラーで 500 になるのを避けるため）。
func Test_チケット作成_開始日が期限より後なら拒否(t *testing.T) {
	uc := ticket.NewCreateTicketUseCase(&mockTicketRepo{}, fakeTxManager{})
	start, due := "2026-09-10", "2026-09-01"

	_, err := uc.Execute(context.Background(), ticket.CreateTicketInput{
		WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", CreatedByUserID: 1,
		StartDate: &start, DueDate: &due,
	})
	require.ErrorIs(t, err, domain.ErrTicketDateRangeInverted)
}

// type/status を指定しなければ既定（GetDefaultTicketType / GetInitialTicketStatus）を解決する。
// 並び順は末尾（LastTicketRankPosition から fracindex.Between で採番）に置く。
func Test_チケット作成_既定の種別と状態を解決して作る(t *testing.T) {
	repo := &mockTicketRepo{}
	defaultType := tkDefaultType()
	initialStatus := tkInitialStatus()
	repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(&defaultType, nil)
	repo.On("GetInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(&initialStatus, nil)
	repo.On("LastTicketRankPosition", mock.Anything, tkWS, tkProject).Return("a0", nil)

	var captured repository.TicketCreateInput
	repo.On("CreateTicket", mock.Anything, mock.AnythingOfType("repository.TicketCreateInput")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(repository.TicketCreateInput) }).
		Return(&domain.Ticket{ID: "01a00000-0000-7000-8000-000000000040", WorkspaceID: tkWS, ProjectID: tkProject, Number: 1}, nil)
	repo.On("InsertTicketRank", mock.Anything, tkWS, mock.AnythingOfType("string"), "01a00000-0000-7000-8000-000000000040", mock.AnythingOfType("string")).Return(nil)
	repo.On("InsertTicketPathSelf", mock.Anything, tkWS, "01a00000-0000-7000-8000-000000000040").Return(nil)
	repo.On("ReplaceTicketPageLinks", mock.Anything, tkWS, mock.Anything, []string(nil)).Return(nil)
	repo.On("ReplaceTicketTicketLinks", mock.Anything, tkWS, mock.Anything, []string(nil)).Return(nil)

	got, err := ticket.NewCreateTicketUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.CreateTicketInput{
		WorkspaceID: tkWS, ProjectID: tkProject, Title: "新しいチケット",
		Doc: `{"type":"doc","content":[]}`, CreatedByUserID: 1,
	})

	require.NoError(t, err)
	assert.Equal(t, "01a00000-0000-7000-8000-000000000040", got.ID)
	assert.Equal(t, defaultType.ID, captured.TypeID)
	assert.Equal(t, initialStatus.ID, captured.StatusID)
	assert.Equal(t, domain.TicketPriorityDefault, captured.Priority)
	assert.Nil(t, captured.ParentID)
	assert.Greater(t, got.Position, "a0", "既存の末尾より後ろに置く（応答の position は並び順の表由来）")
}

func Test_チケット作成_既定の種別が無ければ拒否(t *testing.T) {
	// 有効化されていないプロジェクトでは GetDefaultTicketType が ErrTicketTypeNotFound を返す。
	repo := &mockTicketRepo{}
	repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(nil, repository.ErrTicketTypeNotFound)

	_, err := ticket.NewCreateTicketUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.CreateTicketInput{
		WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", Doc: `{"type":"doc","content":[]}`, CreatedByUserID: 1,
	})
	require.ErrorIs(t, err, repository.ErrTicketTypeNotFound)
}

// 親を指定するときは、同じプロジェクトに実在し、種別の階層規則を満たすことを検証する。
func Test_チケット作成_親を指定する場合の階層規則(t *testing.T) {
	t.Run("親のレベルより深い子は拒否", func(t *testing.T) {
		repo := &mockTicketRepo{}
		defaultType := tkDefaultType() // level 0
		initialStatus := tkInitialStatus()
		parentType := domain.TicketType{ID: "type-sub", HierarchyLevel: -1}
		parent := domain.Ticket{ID: tkParent, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-sub", ArchivedAt: nil}
		repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(&defaultType, nil)
		repo.On("GetInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(&initialStatus, nil)
		repo.On("FindTicket", mock.Anything, tkWS, tkParent).Return(&parent, nil)
		repo.On("FindTicketType", mock.Anything, tkWS, tkProject, "type-sub").Return(&parentType, nil)
		repo.On("ListTicketParentChain", mock.Anything, tkWS, tkParent).Return([]domain.Ticket{}, nil)

		_, err := ticket.NewCreateTicketUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.CreateTicketInput{
			WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", Doc: `{"type":"doc","content":[]}`,
			CreatedByUserID: 1, ParentID: &tkParent,
		})
		require.ErrorIs(t, err, domain.ErrTicketHierarchyRejected)
	})

	t.Run("深さ4は拒否", func(t *testing.T) {
		repo := &mockTicketRepo{}
		defaultType := tkDefaultType()
		initialStatus := tkInitialStatus()
		parentType := domain.TicketType{ID: "type-task", HierarchyLevel: 0}
		parent := domain.Ticket{ID: tkParent, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task"}
		repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(&defaultType, nil)
		repo.On("GetInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(&initialStatus, nil)
		repo.On("FindTicket", mock.Anything, tkWS, tkParent).Return(&parent, nil)
		repo.On("FindTicketType", mock.Anything, tkWS, tkProject, "type-task").Return(&parentType, nil)
		// ListTicketParentChain は「自分を含まない」祖先列（root から順）。親が root(depth1)
		// から数えて既に 2 段の祖先を持つ = 親自身は depth 3。その子は depth 4 になり、
		// 最大 3 段を超える。
		repo.On("ListTicketParentChain", mock.Anything, tkWS, tkParent).Return([]domain.Ticket{
			{ID: "root"}, {ID: "a"},
		}, nil)

		_, err := ticket.NewCreateTicketUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.CreateTicketInput{
			WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", Doc: `{"type":"doc","content":[]}`,
			CreatedByUserID: 1, ParentID: &tkParent,
		})
		require.ErrorIs(t, err, domain.ErrTicketHierarchyRejected)
	})

	t.Run("親が実在し規則を満たせば閉包表の自己参照と祖先集合の両方を張る", func(t *testing.T) {
		repo := &mockTicketRepo{}
		defaultType := tkDefaultType() // level 0
		initialStatus := tkInitialStatus()
		parentType := domain.TicketType{ID: "type-task", HierarchyLevel: 0}
		parent := domain.Ticket{ID: tkParent, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task"}
		repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(&defaultType, nil)
		repo.On("GetInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(&initialStatus, nil)
		repo.On("FindTicket", mock.Anything, tkWS, tkParent).Return(&parent, nil)
		repo.On("FindTicketType", mock.Anything, tkWS, tkProject, "type-task").Return(&parentType, nil)
		repo.On("ListTicketParentChain", mock.Anything, tkWS, tkParent).Return([]domain.Ticket{}, nil)
		repo.On("LastTicketRankPosition", mock.Anything, tkWS, tkProject).Return("a0", nil)
		newID := "01a00000-0000-7000-8000-000000000050"
		repo.On("CreateTicket", mock.Anything, mock.AnythingOfType("repository.TicketCreateInput")).
			Return(&domain.Ticket{ID: newID, WorkspaceID: tkWS, ProjectID: tkProject}, nil)
		repo.On("InsertTicketRank", mock.Anything, tkWS, mock.AnythingOfType("string"), newID, mock.AnythingOfType("string")).Return(nil)
		repo.On("InsertTicketPathSelf", mock.Anything, tkWS, newID).Return(nil)
		repo.On("InsertTicketPathAncestors", mock.Anything, tkWS, newID, tkParent).Return(nil)
		repo.On("ReplaceTicketPageLinks", mock.Anything, tkWS, newID, []string(nil)).Return(nil)
		repo.On("ReplaceTicketTicketLinks", mock.Anything, tkWS, newID, []string(nil)).Return(nil)

		_, err := ticket.NewCreateTicketUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.CreateTicketInput{
			WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", Doc: `{"type":"doc","content":[]}`,
			CreatedByUserID: 1, ParentID: &tkParent,
		})
		require.NoError(t, err)
		repo.AssertCalled(t, "InsertTicketPathSelf", mock.Anything, tkWS, newID)
		repo.AssertCalled(t, "InsertTicketPathAncestors", mock.Anything, tkWS, newID, tkParent)
	})

	t.Run("別プロジェクトの親は404相当", func(t *testing.T) {
		repo := &mockTicketRepo{}
		defaultType := tkDefaultType()
		initialStatus := tkInitialStatus()
		otherSpaceParent := domain.Ticket{ID: tkParent, WorkspaceID: tkWS, ProjectID: "other-space", TypeID: "type-task"}
		repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(&defaultType, nil)
		repo.On("GetInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(&initialStatus, nil)
		repo.On("FindTicket", mock.Anything, tkWS, tkParent).Return(&otherSpaceParent, nil)

		_, err := ticket.NewCreateTicketUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.CreateTicketInput{
			WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", Doc: `{"type":"doc","content":[]}`,
			CreatedByUserID: 1, ParentID: &tkParent,
		})
		require.ErrorIs(t, err, repository.ErrTicketNotFound)
	})
}

// 本文保存時と同じく、作成時も pageRef/ticketRef の title を剥がし、plain_text を作り、
// 派生表（ticket_page_links / ticket_ticket_links）を張る。
func Test_チケット作成_本文から参照を張る(t *testing.T) {
	repo := &mockTicketRepo{}
	defaultType := tkDefaultType()
	initialStatus := tkInitialStatus()
	repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(&defaultType, nil)
	repo.On("GetInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(&initialStatus, nil)
	repo.On("LastTicketRankPosition", mock.Anything, tkWS, tkProject).Return("", nil)

	pageID := "01a00000-0000-7000-8000-0000000000e1"
	var captured repository.TicketCreateInput
	repo.On("CreateTicket", mock.Anything, mock.AnythingOfType("repository.TicketCreateInput")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(repository.TicketCreateInput) }).
		Return(&domain.Ticket{ID: "ticket-1", WorkspaceID: tkWS, ProjectID: tkProject}, nil)
	repo.On("InsertTicketRank", mock.Anything, tkWS, mock.AnythingOfType("string"), "ticket-1", mock.AnythingOfType("string")).Return(nil)
	repo.On("InsertTicketPathSelf", mock.Anything, tkWS, "ticket-1").Return(nil)
	repo.On("ReplaceTicketPageLinks", mock.Anything, tkWS, "ticket-1", []string{pageID}).Return(nil)
	repo.On("ReplaceTicketTicketLinks", mock.Anything, tkWS, "ticket-1", []string(nil)).Return(nil)

	doc := `{"type":"doc","content":[{"type":"paragraph","content":[
		{"type":"text","text":"参照先はこちら: "},
		{"type":"pageRef","attrs":{"pageId":"` + pageID + `","title":"隠したい題名"}}
	]}]}`
	_, err := ticket.NewCreateTicketUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.CreateTicketInput{
		WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", Doc: doc, CreatedByUserID: 1,
	})
	require.NoError(t, err)

	assert.NotContains(t, string(captured.Doc), "隠したい題名", "保存前に title を剥がす")
	assert.Contains(t, string(captured.Doc), pageID)
	assert.NotEmpty(t, captured.PlainText)
	assert.NotContains(t, captured.PlainText, "隠したい題名")
	repo.AssertCalled(t, "ReplaceTicketPageLinks", mock.Anything, tkWS, "ticket-1", []string{pageID})
}

// countingTxManager は DoInTx が呼ばれたか、そして中で落ちたときに取引として扱われたかを見る。
// fn の戻りをそのまま返すので、本物と同じく「fn がエラーなら全体がエラー」になる。
type countingTxManager struct {
	calls    int
	lastErr  error
	rolledBk bool
}

func (m *countingTxManager) DoInTx(ctx context.Context, fn func(ctx context.Context) error) error {
	m.calls++
	err := fn(ctx)
	m.lastErr = err
	m.rolledBk = err != nil
	return err
}

// 作成は tickets への 1 本だけでは終わらない（並び順・閉包表・派生表）。途中の失敗で
// 「チケット行だけ在る」中途半端な状態を残さないよう、ひとまとまりの取引になっていること。
//
// 旧 ticket_ranks の一意制約が壊れていた頃、並び順の INSERT だけが落ちてチケットが残る事故が
// 本番で起きた。制約は直したが、取引で包まれていることそのものをここで固定する。
func Test_チケット作成_途中で落ちたら取引ごと巻き戻す(t *testing.T) {
	repo := &mockTicketRepo{}
	defaultType := tkDefaultType()
	initialStatus := tkInitialStatus()
	repo.On("GetDefaultTicketType", mock.Anything, tkWS, tkProject).Return(&defaultType, nil)
	repo.On("GetInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(&initialStatus, nil)
	repo.On("LastTicketRankPosition", mock.Anything, tkWS, tkProject).Return("", nil)
	repo.On("CreateTicket", mock.Anything, mock.AnythingOfType("repository.TicketCreateInput")).
		Return(&domain.Ticket{ID: "ticket-1", WorkspaceID: tkWS, ProjectID: tkProject}, nil)
	// 並び順の INSERT だけが落ちる（本番で起きた形）。
	rankErr := errors.New("duplicate key value violates unique constraint")
	repo.On("InsertTicketRank", mock.Anything, tkWS, tkProject, "ticket-1", mock.AnythingOfType("string")).Return(rankErr)

	tx := &countingTxManager{}
	_, err := ticket.NewCreateTicketUseCase(repo, tx).Execute(context.Background(), ticket.CreateTicketInput{
		WorkspaceID: tkWS, ProjectID: tkProject, Title: "x", Doc: `{"type":"doc","content":[]}`, CreatedByUserID: 1,
	})

	require.Error(t, err, "並び順を書けなければ作成そのものが失敗する")
	assert.Equal(t, 1, tx.calls, "書き込みは取引の中で行う")
	assert.True(t, tx.rolledBk, "取引は巻き戻される（チケット行だけ残さない）")
	// 並び順で落ちた時点で後続は撃たない（巻き戻す前提なので、書くだけ無駄な上に紛らわしい）。
	repo.AssertNotCalled(t, "InsertTicketPathSelf", mock.Anything, tkWS, "ticket-1")
	repo.AssertNotCalled(t, "ReplaceTicketPageLinks", mock.Anything, tkWS, "ticket-1", mock.Anything)
}
