package kb

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// AddPageLabelUseCase はページにラベルを付ける（ticket.AddTicketLabelUseCase のページ版）。
// ラベルはワークスペースごとの語彙で、別ワークスペースのラベル ID は FindLabel の時点で
// repository.ErrLabelNotFound になる（ticket 側と同じ「見えない」と「存在しない」を
// 同じ扱いにする方針 — 他ワークスペースのラベル ID が実在するかどうかをここで漏らさない）。
type AddPageLabelUseCase struct {
	labels repository.LabelRepository
	pages  repository.KnowledgeBaseRepository
}

func NewAddPageLabelUseCase(l repository.LabelRepository, p repository.KnowledgeBaseRepository) *AddPageLabelUseCase {
	return &AddPageLabelUseCase{labels: l, pages: p}
}

type AddPageLabelInput struct {
	WorkspaceID string
	PageID      string
	LabelID     string
}

func (u *AddPageLabelUseCase) Execute(ctx context.Context, in AddPageLabelInput) error {
	if in.WorkspaceID == "" || in.PageID == "" || in.LabelID == "" {
		return errors.New("workspaceID, pageID and labelID are required")
	}
	if _, err := u.pages.FindPage(ctx, in.WorkspaceID, in.PageID); err != nil {
		return err
	}
	if _, err := u.labels.FindLabel(ctx, in.WorkspaceID, in.LabelID); err != nil {
		return err
	}
	return u.labels.AddPageLabel(ctx, in.WorkspaceID, in.PageID, in.LabelID)
}

// RemovePageLabelUseCase はページからラベルを外す（付いていなくても冪等に成功する。
// ticket.RemoveTicketLabelUseCase と同じ理由 — DELETE 自体が workspace_id/page_id/label_id
// で絞るので、空間の一致を別途確かめる必要が無い）。
type RemovePageLabelUseCase struct {
	repo repository.LabelRepository
}

func NewRemovePageLabelUseCase(r repository.LabelRepository) *RemovePageLabelUseCase {
	return &RemovePageLabelUseCase{repo: r}
}

type RemovePageLabelInput struct {
	WorkspaceID string
	PageID      string
	LabelID     string
}

func (u *RemovePageLabelUseCase) Execute(ctx context.Context, in RemovePageLabelInput) error {
	if in.WorkspaceID == "" || in.PageID == "" || in.LabelID == "" {
		return errors.New("workspaceID, pageID and labelID are required")
	}
	return u.repo.RemovePageLabel(ctx, in.WorkspaceID, in.PageID, in.LabelID)
}

// ListLabelsForPageUseCase はページ 1 件のラベル一覧を返す（ticket.ListLabelsForTicketUseCase
// のページ版。詳細画面向け）。
type ListLabelsForPageUseCase struct {
	repo repository.LabelRepository
}

func NewListLabelsForPageUseCase(r repository.LabelRepository) *ListLabelsForPageUseCase {
	return &ListLabelsForPageUseCase{repo: r}
}

func (u *ListLabelsForPageUseCase) Execute(ctx context.Context, workspaceID, pageID string) ([]domain.Label, error) {
	if workspaceID == "" || pageID == "" {
		return nil, errors.New("workspaceID and pageID are required")
	}
	return u.repo.ListLabelsByPage(ctx, workspaceID, pageID)
}
