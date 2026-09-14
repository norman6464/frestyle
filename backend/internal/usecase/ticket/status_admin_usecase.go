package ticket

import (
	"context"
	"errors"
	"strings"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrTicketStatusInUse / ErrTicketTypeInUse は「現役のチケットが参照している」状態・種別を
// アーカイブしようとしたときに返す。DB は物理削除しか止められない（設計 Ⅳ-C）ため、
// アーカイブ前のこの検査が使用中を守る唯一の場所。
var (
	ErrTicketStatusInUse = errors.New("ticket status is in use")
	ErrTicketTypeInUse   = errors.New("ticket type is in use")
)

// CreateTicketStatusUseCase はプロジェクトに状態を 1 つ追加する。新規作成では初期状態にしない
// （初期状態の切り替えは SetInitialTicketStatusUseCase の専任）。
type CreateTicketStatusUseCase struct {
	repo repository.TicketRepository
}

func NewCreateTicketStatusUseCase(r repository.TicketRepository) *CreateTicketStatusUseCase {
	return &CreateTicketStatusUseCase{repo: r}
}

type CreateTicketStatusInput struct {
	WorkspaceID string
	ProjectID   string
	Name        string
	Category    domain.TicketStatusCategory
	Color       string
}

func (u *CreateTicketStatusUseCase) Execute(ctx context.Context, in CreateTicketStatusInput) (*domain.TicketStatus, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ProjectID == "" {
		return nil, errors.New("projectID is required")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, domain.ErrInvalidTicketName
	}
	if !in.Category.Valid() {
		return nil, domain.ErrInvalidTicketStatusCategory
	}
	color := domain.NormalizeHexColor(in.Color)
	if !domain.ValidHexColor(color) {
		return nil, domain.ErrInvalidTicketColor
	}

	last, err := u.repo.LastActiveTicketStatusPosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return nil, err
	}

	status := &domain.TicketStatus{
		WorkspaceID: in.WorkspaceID, ProjectID: in.ProjectID,
		Name: name, Category: in.Category, Color: color, Position: pos,
	}
	if err := u.repo.InsertTicketStatus(ctx, status); err != nil {
		return nil, err
	}
	return status, nil
}

// UpdateTicketStatusUseCase は状態の名前・枠・色を書き換える。
type UpdateTicketStatusUseCase struct {
	repo repository.TicketRepository
}

func NewUpdateTicketStatusUseCase(r repository.TicketRepository) *UpdateTicketStatusUseCase {
	return &UpdateTicketStatusUseCase{repo: r}
}

type UpdateTicketStatusInput struct {
	WorkspaceID string
	ProjectID   string
	StatusID    string
	Name        string
	Category    domain.TicketStatusCategory
	Color       string
}

func (u *UpdateTicketStatusUseCase) Execute(ctx context.Context, in UpdateTicketStatusInput) (*domain.TicketStatus, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.StatusID == "" {
		return nil, errors.New("workspaceID, projectID and statusID are required")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, domain.ErrInvalidTicketName
	}
	if !in.Category.Valid() {
		return nil, domain.ErrInvalidTicketStatusCategory
	}
	color := domain.NormalizeHexColor(in.Color)
	if !domain.ValidHexColor(color) {
		return nil, domain.ErrInvalidTicketColor
	}
	status := &domain.TicketStatus{
		ID: in.StatusID, WorkspaceID: in.WorkspaceID, ProjectID: in.ProjectID,
		Name: name, Category: in.Category, Color: color,
	}
	if err := u.repo.UpdateTicketStatus(ctx, status); err != nil {
		return nil, err
	}
	return status, nil
}

// SetInitialTicketStatusUseCase は新規チケット作成時の既定状態を切り替える。
type SetInitialTicketStatusUseCase struct {
	repo repository.TicketRepository
}

func NewSetInitialTicketStatusUseCase(r repository.TicketRepository) *SetInitialTicketStatusUseCase {
	return &SetInitialTicketStatusUseCase{repo: r}
}

type SetInitialTicketStatusInput struct {
	WorkspaceID string
	ProjectID   string
	StatusID    string
}

func (u *SetInitialTicketStatusUseCase) Execute(ctx context.Context, in SetInitialTicketStatusInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.StatusID == "" {
		return errors.New("workspaceID, projectID and statusID are required")
	}
	return u.repo.SetTicketStatusInitial(ctx, in.WorkspaceID, in.ProjectID, in.StatusID)
}

// ArchiveTicketStatusUseCase は状態をアーカイブする。現役のチケットが参照していれば拒否する
// （設計 Ⅵ 段 1 の負例）。
type ArchiveTicketStatusUseCase struct {
	repo repository.TicketRepository
}

func NewArchiveTicketStatusUseCase(r repository.TicketRepository) *ArchiveTicketStatusUseCase {
	return &ArchiveTicketStatusUseCase{repo: r}
}

type ArchiveTicketStatusInput struct {
	WorkspaceID string
	ProjectID   string
	StatusID    string
}

func (u *ArchiveTicketStatusUseCase) Execute(ctx context.Context, in ArchiveTicketStatusInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.StatusID == "" {
		return errors.New("workspaceID, projectID and statusID are required")
	}
	count, err := u.repo.CountActiveTicketsByStatus(ctx, in.WorkspaceID, in.ProjectID, in.StatusID)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrTicketStatusInUse
	}
	return u.repo.ArchiveTicketStatus(ctx, in.WorkspaceID, in.ProjectID, in.StatusID)
}

// RestoreTicketStatusUseCase はアーカイブ済み状態を現役へ戻す。position は末尾へ付け直す。
// 現役の中に同名（大文字小文字を区別しない）があれば repository.ErrTicketStatusNameTaken を
// そのまま伝える（409 相当。設計 Ⅳ 冒頭の作法）。
type RestoreTicketStatusUseCase struct {
	repo repository.TicketRepository
}

func NewRestoreTicketStatusUseCase(r repository.TicketRepository) *RestoreTicketStatusUseCase {
	return &RestoreTicketStatusUseCase{repo: r}
}

type RestoreTicketStatusInput struct {
	WorkspaceID string
	ProjectID   string
	StatusID    string
}

func (u *RestoreTicketStatusUseCase) Execute(ctx context.Context, in RestoreTicketStatusInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.StatusID == "" {
		return errors.New("workspaceID, projectID and statusID are required")
	}
	last, err := u.repo.LastActiveTicketStatusPosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return err
	}
	return u.repo.RestoreTicketStatus(ctx, in.WorkspaceID, in.ProjectID, in.StatusID, pos)
}
