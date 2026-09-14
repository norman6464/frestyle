package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func Test_ラベル作成_不正な値は拒否(t *testing.T) {
	uc := ticket.NewCreateLabelUseCase(&mockLabelRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, ticket.CreateLabelInput{WorkspaceID: tkWS, Name: "", Color: "#2f6b47"})
	require.ErrorIs(t, err, domain.ErrInvalidLabelName, "空の名前は拒否")
	_, err = uc.Execute(ctx, ticket.CreateLabelInput{WorkspaceID: tkWS, Name: "  ", Color: "#2f6b47"})
	require.ErrorIs(t, err, domain.ErrInvalidLabelName, "空白だけの名前も拒否")
	_, err = uc.Execute(ctx, ticket.CreateLabelInput{WorkspaceID: tkWS, Name: "OK", Color: "url(evil)"})
	require.ErrorIs(t, err, domain.ErrInvalidLabelColor, "不正な色は拒否")
}

func Test_ラベル作成_ワークスペースが無ければ拒否(t *testing.T) {
	repo := &mockLabelRepo{}
	_, err := ticket.NewCreateLabelUseCase(repo).Execute(context.Background(), ticket.CreateLabelInput{
		Name: "緊急", Color: "#2f6b47",
	})
	require.Error(t, err)
	repo.AssertNotCalled(t, "CreateLabel")
}

func Test_ラベル作成_名前をトリムし色を正規化してから保存する(t *testing.T) {
	repo := &mockLabelRepo{}
	var captured *domain.Label
	repo.On("CreateLabel", mock.Anything, mock.AnythingOfType("*domain.Label")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(*domain.Label) }).Return(nil)

	_, err := ticket.NewCreateLabelUseCase(repo).Execute(context.Background(), ticket.CreateLabelInput{
		WorkspaceID: tkWS, Name: "  緊急  ", Color: "#FF0000",
	})
	require.NoError(t, err)
	require.Equal(t, "緊急", captured.Name)
	require.Equal(t, "#ff0000", captured.Color)
	require.Equal(t, tkWS, captured.WorkspaceID)
}

func Test_ラベル更新_同名なら重複エラーをそのまま伝える(t *testing.T) {
	repo := &mockLabelRepo{}
	repo.On("UpdateLabel", mock.Anything, mock.AnythingOfType("*domain.Label")).
		Return(repository.ErrLabelNameTaken)

	_, err := ticket.NewUpdateLabelUseCase(repo).Execute(context.Background(), ticket.UpdateLabelInput{
		WorkspaceID: tkWS, LabelID: "label-1", Name: "重複", Color: "#2f6b47",
	})
	require.ErrorIs(t, err, repository.ErrLabelNameTaken)
}

func Test_ラベル更新_必須項目が無ければ拒否(t *testing.T) {
	repo := &mockLabelRepo{}
	_, err := ticket.NewUpdateLabelUseCase(repo).Execute(context.Background(), ticket.UpdateLabelInput{
		WorkspaceID: tkWS, Name: "改名", Color: "#2f6b47",
	})
	require.Error(t, err, "labelID 必須")
	repo.AssertNotCalled(t, "UpdateLabel")
}

func Test_ラベル更新_ワークスペースを添えて書き換える(t *testing.T) {
	repo := &mockLabelRepo{}
	var captured *domain.Label
	repo.On("UpdateLabel", mock.Anything, mock.AnythingOfType("*domain.Label")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(*domain.Label) }).Return(nil)

	_, err := ticket.NewUpdateLabelUseCase(repo).Execute(context.Background(), ticket.UpdateLabelInput{
		WorkspaceID: tkWS, LabelID: "label-1", Name: "改名", Color: "#2f6b47",
	})
	require.NoError(t, err)
	require.Equal(t, tkWS, captured.WorkspaceID, "SQL 側でもテナントで絞れるよう渡す")
	require.Equal(t, "label-1", captured.ID)
}

func Test_チケットへのラベル付与_別ワークスペースのラベルは拒否(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).
		Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject}, nil)
	labels := &mockLabelRepo{}
	// FindLabel は (workspace_id, label_id) で絞るので、別テナントのラベルはここで「無い」になる。
	labels.On("FindLabel", mock.Anything, tkWS, "label-1").Return(nil, repository.ErrLabelNotFound)

	err := ticket.NewAddTicketLabelUseCase(labels, tickets).Execute(context.Background(), ticket.AddTicketLabelInput{
		WorkspaceID: tkWS, TicketID: tkTicket, LabelID: "label-1",
	})
	require.ErrorIs(t, err, repository.ErrLabelNotFound)
	labels.AssertNotCalled(t, "AddTicketLabel")
}

func Test_チケットへのラベル付与_チケットが無ければラベルを引かない(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)
	labels := &mockLabelRepo{}

	err := ticket.NewAddTicketLabelUseCase(labels, tickets).Execute(context.Background(), ticket.AddTicketLabelInput{
		WorkspaceID: tkWS, TicketID: tkTicket, LabelID: "label-1",
	})
	require.ErrorIs(t, err, repository.ErrTicketNotFound)
	labels.AssertNotCalled(t, "FindLabel")
	labels.AssertNotCalled(t, "AddTicketLabel")
}

func Test_チケットへのラベル付与_同じワークスペースなら付ける(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).
		Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject}, nil)
	labels := &mockLabelRepo{}
	labels.On("FindLabel", mock.Anything, tkWS, "label-1").
		Return(&domain.Label{ID: "label-1", WorkspaceID: tkWS}, nil)
	labels.On("AddTicketLabel", mock.Anything, tkWS, tkTicket, "label-1").Return(nil)

	err := ticket.NewAddTicketLabelUseCase(labels, tickets).Execute(context.Background(), ticket.AddTicketLabelInput{
		WorkspaceID: tkWS, TicketID: tkTicket, LabelID: "label-1",
	})
	require.NoError(t, err)
	labels.AssertExpectations(t)
}

func Test_チケットからのラベル除去_付いていなくても冪等に成功する(t *testing.T) {
	repo := &mockLabelRepo{}
	repo.On("RemoveTicketLabel", mock.Anything, tkWS, tkTicket, "label-1").Return(nil)

	err := ticket.NewRemoveTicketLabelUseCase(repo).Execute(context.Background(), ticket.RemoveTicketLabelInput{
		WorkspaceID: tkWS, TicketID: tkTicket, LabelID: "label-1",
	})
	require.NoError(t, err)
}

func Test_ラベル一覧_ワークスペース単位で返す(t *testing.T) {
	repo := &mockLabelRepo{}
	want := []domain.Label{{ID: "label-1", Name: "緊急"}}
	repo.On("ListLabels", mock.Anything, tkWS).Return(want, nil)

	got, err := ticket.NewListLabelsUseCase(repo).Execute(context.Background(), tkWS)
	require.NoError(t, err)
	require.Equal(t, want, got)
}

func Test_ラベル一覧_ワークスペースが無ければ拒否(t *testing.T) {
	repo := &mockLabelRepo{}
	_, err := ticket.NewListLabelsUseCase(repo).Execute(context.Background(), "")
	require.Error(t, err)
	repo.AssertNotCalled(t, "ListLabels")
}

func Test_チケット単位のラベル一覧(t *testing.T) {
	repo := &mockLabelRepo{}
	want := []domain.Label{{ID: "label-1", Name: "緊急"}}
	repo.On("ListLabelsByTicket", mock.Anything, tkWS, tkTicket).Return(want, nil)

	got, err := ticket.NewListLabelsForTicketUseCase(repo).Execute(context.Background(), tkWS, tkTicket)
	require.NoError(t, err)
	require.Equal(t, want, got)
}

func Test_チケットID群のラベル一括取得(t *testing.T) {
	repo := &mockLabelRepo{}
	want := map[string][]domain.Label{tkTicket: {{ID: "label-1", Name: "緊急"}}}
	repo.On("ListLabelsByTicketIDs", mock.Anything, tkWS, []string{tkTicket}).Return(want, nil)

	got, err := ticket.NewListLabelsByTicketIDsUseCase(repo).Execute(context.Background(), tkWS, []string{tkTicket})
	require.NoError(t, err)
	require.Equal(t, want, got)
}

func Test_ラベル削除(t *testing.T) {
	repo := &mockLabelRepo{}
	repo.On("DeleteLabel", mock.Anything, tkWS, "label-1").Return(nil)

	err := ticket.NewDeleteLabelUseCase(repo).Execute(context.Background(), tkWS, "label-1")
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func Test_ラベル削除_必須項目が無ければ拒否(t *testing.T) {
	repo := &mockLabelRepo{}

	err := ticket.NewDeleteLabelUseCase(repo).Execute(context.Background(), tkWS, "")
	require.Error(t, err)
	repo.AssertNotCalled(t, "DeleteLabel")
}
