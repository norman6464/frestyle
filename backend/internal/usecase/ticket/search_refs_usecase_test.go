package ticket_test

import (
	"context"
	"errors"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const refWS = "00000000-0000-7000-8000-00000000cccc"

func Test_チケット参照の候補_打った語を整えて読み取り口へ渡す(t *testing.T) {
	refs := &mockTicketRefReader{}
	want := []domain.TicketRefFact{{ID: "t1", ProjectKey: "eng", Number: 3, Title: "表を直す", StatusName: "To Do", StatusCategory: domain.TicketStatusCategoryTodo}}
	refs.On("SearchTicketRefFacts", mock.Anything, refWS, "表", 8).Return(want, nil)

	got, err := ticket.NewSearchTicketRefsUseCase(refs).Execute(context.Background(), ticket.SearchTicketRefsInput{
		WorkspaceID: refWS, Query: "  表  ", Limit: 8,
	})
	require.NoError(t, err)
	assert.Equal(t, want, got)
	refs.AssertExpectations(t)
}

func Test_チケット参照の候補_空の語では探さず空を返す(t *testing.T) {
	refs := &mockTicketRefReader{}
	got, err := ticket.NewSearchTicketRefsUseCase(refs).Execute(context.Background(), ticket.SearchTicketRefsInput{
		WorkspaceID: refWS, Query: "   ", Limit: 8,
	})
	require.NoError(t, err)
	assert.Empty(t, got)
	assert.NotNil(t, got, "応答の tickets は空配列（null にしない）")
	refs.AssertNotCalled(t, "SearchTicketRefFacts")
}

func Test_チケット参照の候補_件数の範囲外は断る(t *testing.T) {
	refs := &mockTicketRefReader{}
	uc := ticket.NewSearchTicketRefsUseCase(refs)
	for _, limit := range []int{0, ticket.MaxTicketRefSearchLimit + 1} {
		_, err := uc.Execute(context.Background(), ticket.SearchTicketRefsInput{WorkspaceID: refWS, Query: "x", Limit: limit})
		assert.ErrorIs(t, err, ticket.ErrInvalidTicketRefSearchLimit, "limit=%d", limit)
	}
	_, err := uc.Execute(context.Background(), ticket.SearchTicketRefsInput{Query: "x", Limit: 1})
	assert.Error(t, err, "ワークスペースは必須")
	refs.AssertNotCalled(t, "SearchTicketRefFacts")
}

func Test_チケット参照の候補_読み取りの失敗はそのまま返す(t *testing.T) {
	refs := &mockTicketRefReader{}
	refs.On("SearchTicketRefFacts", mock.Anything, refWS, "x", 1).Return(nil, errors.New("db down"))
	_, err := ticket.NewSearchTicketRefsUseCase(refs).Execute(context.Background(), ticket.SearchTicketRefsInput{WorkspaceID: refWS, Query: "x", Limit: 1})
	assert.EqualError(t, err, "db down")
}
