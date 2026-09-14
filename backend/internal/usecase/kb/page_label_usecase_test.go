package kb_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const kbLabelID = "0198a000-0000-7000-8000-000000000006"

// Test_ページラベル_同じワークスペースのラベルなら付けられる は AddPageLabelUseCase が
// ticket.AddTicketLabelUseCase と同じ形で、ページとラベルの実在を確かめてから
// repository.AddPageLabel を呼ぶことを固定する。
func Test_ページラベル_同じワークスペースのラベルなら付けられる(t *testing.T) {
	pages := &mockKnowledgeBaseRepo{}
	pages.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	labels := &mockLabelRepo{}
	labels.On("FindLabel", mock.Anything, kbWS, kbLabelID).
		Return(&domain.Label{ID: kbLabelID, WorkspaceID: kbWS}, nil)
	labels.On("AddPageLabel", mock.Anything, kbWS, kbPage, kbLabelID).Return(nil)
	uc := kb.NewAddPageLabelUseCase(labels, pages)

	err := uc.Execute(context.Background(), kb.AddPageLabelInput{
		WorkspaceID: kbWS, PageID: kbPage, LabelID: kbLabelID,
	})
	require.NoError(t, err)
	labels.AssertExpectations(t)
}

func Test_ページラベル_対象ページが無ければそのエラーを返す(t *testing.T) {
	pages := &mockKnowledgeBaseRepo{}
	pages.On("FindPage", mock.Anything, kbWS, kbPage).Return(nil, repository.ErrPageNotFound)
	labels := &mockLabelRepo{}
	uc := kb.NewAddPageLabelUseCase(labels, pages)

	err := uc.Execute(context.Background(), kb.AddPageLabelInput{
		WorkspaceID: kbWS, PageID: kbPage, LabelID: kbLabelID,
	})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
	labels.AssertNotCalled(t, "FindLabel", mock.Anything, mock.Anything, mock.Anything)
}

// 別ワークスペースのラベル ID も同じ経路に落ちる（FindLabel が (workspace_id, label_id) で
// 絞るため）。他テナントのラベルが実在するかどうかをここで漏らさない方針。
func Test_ページラベル_対象ラベルが無ければそのエラーを返す(t *testing.T) {
	pages := &mockKnowledgeBaseRepo{}
	pages.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	labels := &mockLabelRepo{}
	labels.On("FindLabel", mock.Anything, kbWS, kbLabelID).Return(nil, repository.ErrLabelNotFound)
	uc := kb.NewAddPageLabelUseCase(labels, pages)

	err := uc.Execute(context.Background(), kb.AddPageLabelInput{
		WorkspaceID: kbWS, PageID: kbPage, LabelID: kbLabelID,
	})
	require.ErrorIs(t, err, repository.ErrLabelNotFound)
	labels.AssertNotCalled(t, "AddPageLabel", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページラベル_必須項目が無ければ拒否(t *testing.T) {
	uc := kb.NewAddPageLabelUseCase(&mockLabelRepo{}, &mockKnowledgeBaseRepo{})
	err := uc.Execute(context.Background(), kb.AddPageLabelInput{WorkspaceID: kbWS, PageID: kbPage})
	require.Error(t, err)
}

func Test_ページラベル_外すのは冪等(t *testing.T) {
	labels := &mockLabelRepo{}
	labels.On("RemovePageLabel", mock.Anything, kbWS, kbPage, kbLabelID).Return(nil)
	uc := kb.NewRemovePageLabelUseCase(labels)

	err := uc.Execute(context.Background(), kb.RemovePageLabelInput{
		WorkspaceID: kbWS, PageID: kbPage, LabelID: kbLabelID,
	})
	require.NoError(t, err)
	labels.AssertExpectations(t)
}

func Test_ページラベル_外す_必須項目が無ければ拒否(t *testing.T) {
	labels := &mockLabelRepo{}
	uc := kb.NewRemovePageLabelUseCase(labels)

	err := uc.Execute(context.Background(), kb.RemovePageLabelInput{WorkspaceID: kbWS, PageID: kbPage})
	require.Error(t, err)
	labels.AssertNotCalled(t, "RemovePageLabel", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページラベル_一覧を返す(t *testing.T) {
	labels := &mockLabelRepo{}
	want := []domain.Label{{ID: kbLabelID, WorkspaceID: kbWS, Name: "重要"}}
	labels.On("ListLabelsByPage", mock.Anything, kbWS, kbPage).Return(want, nil)
	uc := kb.NewListLabelsForPageUseCase(labels)

	got, err := uc.Execute(context.Background(), kbWS, kbPage)
	require.NoError(t, err)
	require.Equal(t, want, got)
}

func Test_ページラベル_一覧_必須項目が無ければ拒否(t *testing.T) {
	labels := &mockLabelRepo{}
	uc := kb.NewListLabelsForPageUseCase(labels)

	_, err := uc.Execute(context.Background(), kbWS, "")
	require.Error(t, err)
	labels.AssertNotCalled(t, "ListLabelsByPage", mock.Anything, mock.Anything, mock.Anything)
}
