package ticket

import (
	"context"
	"errors"
	"strings"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// validateLabel は名前・色の形を確かめ、正規化した値を返す（CreateLabelUseCase /
// UpdateLabelUseCase で共有。ticket_statuses の名前・色検証と同じ形）。
func validateLabel(name, color string) (string, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > domain.MaxLabelNameLen {
		return "", "", domain.ErrInvalidLabelName
	}
	color = domain.NormalizeHexColor(color)
	if !domain.ValidHexColor(color) {
		return "", "", domain.ErrInvalidLabelColor
	}
	return name, color, nil
}

// CreateLabelUseCase はワークスペースにラベルを 1 つ追加する。
type CreateLabelUseCase struct {
	repo repository.LabelRepository
}

func NewCreateLabelUseCase(r repository.LabelRepository) *CreateLabelUseCase {
	return &CreateLabelUseCase{repo: r}
}

type CreateLabelInput struct {
	WorkspaceID string
	Name        string
	Color       string
}

func (u *CreateLabelUseCase) Execute(ctx context.Context, in CreateLabelInput) (*domain.Label, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	name, color, err := validateLabel(in.Name, in.Color)
	if err != nil {
		return nil, err
	}
	label := &domain.Label{WorkspaceID: in.WorkspaceID, Name: name, Color: color}
	if err := u.repo.CreateLabel(ctx, label); err != nil {
		return nil, err
	}
	return label, nil
}

// UpdateLabelUseCase はラベルの名前・色を書き換える。
type UpdateLabelUseCase struct {
	repo repository.LabelRepository
}

func NewUpdateLabelUseCase(r repository.LabelRepository) *UpdateLabelUseCase {
	return &UpdateLabelUseCase{repo: r}
}

type UpdateLabelInput struct {
	WorkspaceID string
	LabelID     string
	Name        string
	Color       string
}

func (u *UpdateLabelUseCase) Execute(ctx context.Context, in UpdateLabelInput) (*domain.Label, error) {
	if in.WorkspaceID == "" || in.LabelID == "" {
		return nil, errors.New("workspaceID and labelID are required")
	}
	name, color, err := validateLabel(in.Name, in.Color)
	if err != nil {
		return nil, err
	}
	label := &domain.Label{
		ID: in.LabelID, WorkspaceID: in.WorkspaceID, Name: name, Color: color,
	}
	if err := u.repo.UpdateLabel(ctx, label); err != nil {
		return nil, err
	}
	return label, nil
}

// DeleteLabelUseCase はラベルを削除する（ticket_labels は ON DELETE CASCADE で一緒に消える。
// 論理削除は持たない — labels に他表から参照される正当な undo の必要が無いため）。
type DeleteLabelUseCase struct {
	repo repository.LabelRepository
}

func NewDeleteLabelUseCase(r repository.LabelRepository) *DeleteLabelUseCase {
	return &DeleteLabelUseCase{repo: r}
}

func (u *DeleteLabelUseCase) Execute(ctx context.Context, workspaceID, labelID string) error {
	if workspaceID == "" || labelID == "" {
		return errors.New("workspaceID and labelID are required")
	}
	return u.repo.DeleteLabel(ctx, workspaceID, labelID)
}

// ListLabelsUseCase はワークスペースのラベル一覧を返す。
type ListLabelsUseCase struct {
	repo repository.LabelRepository
}

func NewListLabelsUseCase(r repository.LabelRepository) *ListLabelsUseCase {
	return &ListLabelsUseCase{repo: r}
}

func (u *ListLabelsUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.Label, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListLabels(ctx, workspaceID)
}

// AddTicketLabelUseCase はチケットにラベルを付ける（付け外しは冪等）。ラベルはワークスペース
// ごとの語彙で、別ワークスペースのラベル ID は FindLabel の時点で repository.ErrLabelNotFound に
// なる（他ワークスペースのラベル ID が実在するかをここで漏らさない、既存の
// 「見えない=存在しない」方針）。
type AddTicketLabelUseCase struct {
	labels  repository.LabelRepository
	tickets repository.TicketRepository
}

func NewAddTicketLabelUseCase(l repository.LabelRepository, t repository.TicketRepository) *AddTicketLabelUseCase {
	return &AddTicketLabelUseCase{labels: l, tickets: t}
}

type AddTicketLabelInput struct {
	WorkspaceID string
	TicketID    string
	LabelID     string
}

func (u *AddTicketLabelUseCase) Execute(ctx context.Context, in AddTicketLabelInput) error {
	if in.WorkspaceID == "" || in.TicketID == "" || in.LabelID == "" {
		return errors.New("workspaceID, ticketID and labelID are required")
	}
	if _, err := u.tickets.FindTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return err
	}
	if _, err := u.labels.FindLabel(ctx, in.WorkspaceID, in.LabelID); err != nil {
		return err
	}
	return u.labels.AddTicketLabel(ctx, in.WorkspaceID, in.TicketID, in.LabelID)
}

// RemoveTicketLabelUseCase はチケットからラベルを外す（付いていなくても冪等）。DELETE 自体が
// workspace_id/ticket_id/label_id で絞るため、無関係なラベル ID でも単に 0 行で終わり、
// Add と違い存在確認は不要。
type RemoveTicketLabelUseCase struct {
	repo repository.LabelRepository
}

func NewRemoveTicketLabelUseCase(r repository.LabelRepository) *RemoveTicketLabelUseCase {
	return &RemoveTicketLabelUseCase{repo: r}
}

type RemoveTicketLabelInput struct {
	WorkspaceID string
	TicketID    string
	LabelID     string
}

func (u *RemoveTicketLabelUseCase) Execute(ctx context.Context, in RemoveTicketLabelInput) error {
	if in.WorkspaceID == "" || in.TicketID == "" || in.LabelID == "" {
		return errors.New("workspaceID, ticketID and labelID are required")
	}
	return u.repo.RemoveTicketLabel(ctx, in.WorkspaceID, in.TicketID, in.LabelID)
}

// ListLabelsForTicketUseCase はチケット 1 件のラベル一覧を返す（詳細画面向け。一覧画面は
// handler が ListLabelsByTicketIDs をバッチで呼ぶ）。
type ListLabelsForTicketUseCase struct {
	repo repository.LabelRepository
}

func NewListLabelsForTicketUseCase(r repository.LabelRepository) *ListLabelsForTicketUseCase {
	return &ListLabelsForTicketUseCase{repo: r}
}

func (u *ListLabelsForTicketUseCase) Execute(ctx context.Context, workspaceID, ticketID string) ([]domain.Label, error) {
	if workspaceID == "" || ticketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	return u.repo.ListLabelsByTicket(ctx, workspaceID, ticketID)
}

// ListLabelsByTicketIDsUseCase は一覧画面向けにチケット ID 群のラベルをまとめて引く
// （TicketHandler.List が h.list.Execute の直後に 1 回だけ呼ぶ）。
type ListLabelsByTicketIDsUseCase struct {
	repo repository.LabelRepository
}

func NewListLabelsByTicketIDsUseCase(r repository.LabelRepository) *ListLabelsByTicketIDsUseCase {
	return &ListLabelsByTicketIDsUseCase{repo: r}
}

func (u *ListLabelsByTicketIDsUseCase) Execute(ctx context.Context, workspaceID string, ticketIDs []string) (map[string][]domain.Label, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListLabelsByTicketIDs(ctx, workspaceID, ticketIDs)
}
