package ticket

import (
	"context"
	"errors"
	"strings"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// CreateTicketTypeUseCase はプロジェクトに種別を 1 つ追加する。雛形（TemplateTitle/TemplateDoc）は
// 「雛形から作る」機能そのものが段 1 の対象外のため、この入口では受け付けない
// （列自体は骨格スキーマに含めてあるので、後の段で無停止のまま usecase を足せる）。
type CreateTicketTypeUseCase struct {
	repo repository.TicketRepository
}

func NewCreateTicketTypeUseCase(r repository.TicketRepository) *CreateTicketTypeUseCase {
	return &CreateTicketTypeUseCase{repo: r}
}

type CreateTicketTypeInput struct {
	WorkspaceID    string
	ProjectID      string
	Name           string
	HierarchyLevel int
	Color          string
}

func (u *CreateTicketTypeUseCase) Execute(ctx context.Context, in CreateTicketTypeInput) (*domain.TicketType, error) {
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
	if !domain.ValidTicketHierarchyLevel(in.HierarchyLevel) {
		return nil, domain.ErrInvalidTicketHierarchyLevel
	}
	color := domain.NormalizeHexColor(in.Color)
	if !domain.ValidHexColor(color) {
		return nil, domain.ErrInvalidTicketColor
	}

	last, err := u.repo.LastActiveTicketTypePosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return nil, err
	}

	t := &domain.TicketType{
		WorkspaceID: in.WorkspaceID, ProjectID: in.ProjectID,
		Name: name, HierarchyLevel: in.HierarchyLevel, Color: color, Position: pos,
	}
	if err := u.repo.InsertTicketType(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

// UpdateTicketTypeUseCase は種別の名前・色・階層レベルを書き換える。
//
// hierarchy_level を変えても、既存の親子関係との整合は再検証しない
// （個々のチケットの種別変更時に UpdateTicketUseCase.validateTypeChange が検証する。
// マスタそのものの編集は「今後この種別で作るチケットの既定」を変えるだけで、
// 既存チケットの親子関係を遡って壊さないため、ここでは検査を持たない）。
type UpdateTicketTypeUseCase struct {
	repo repository.TicketRepository
}

func NewUpdateTicketTypeUseCase(r repository.TicketRepository) *UpdateTicketTypeUseCase {
	return &UpdateTicketTypeUseCase{repo: r}
}

type UpdateTicketTypeInput struct {
	WorkspaceID    string
	ProjectID      string
	TypeID         string
	Name           string
	HierarchyLevel int
	Color          string
}

func (u *UpdateTicketTypeUseCase) Execute(ctx context.Context, in UpdateTicketTypeInput) (*domain.TicketType, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.TypeID == "" {
		return nil, errors.New("workspaceID, projectID and typeID are required")
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, domain.ErrInvalidTicketName
	}
	if !domain.ValidTicketHierarchyLevel(in.HierarchyLevel) {
		return nil, domain.ErrInvalidTicketHierarchyLevel
	}
	color := domain.NormalizeHexColor(in.Color)
	if !domain.ValidHexColor(color) {
		return nil, domain.ErrInvalidTicketColor
	}
	t := &domain.TicketType{
		ID: in.TypeID, WorkspaceID: in.WorkspaceID, ProjectID: in.ProjectID,
		Name: name, HierarchyLevel: in.HierarchyLevel, Color: color,
	}
	if err := u.repo.UpdateTicketType(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

// SetDefaultTicketTypeUseCase は新規チケット作成時の既定種別を切り替える。
type SetDefaultTicketTypeUseCase struct {
	repo repository.TicketRepository
}

func NewSetDefaultTicketTypeUseCase(r repository.TicketRepository) *SetDefaultTicketTypeUseCase {
	return &SetDefaultTicketTypeUseCase{repo: r}
}

type SetDefaultTicketTypeInput struct {
	WorkspaceID string
	ProjectID   string
	TypeID      string
}

func (u *SetDefaultTicketTypeUseCase) Execute(ctx context.Context, in SetDefaultTicketTypeInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.TypeID == "" {
		return errors.New("workspaceID, projectID and typeID are required")
	}
	return u.repo.SetTicketTypeDefault(ctx, in.WorkspaceID, in.ProjectID, in.TypeID)
}

// ArchiveTicketTypeUseCase は種別をアーカイブする。現役のチケットが参照していれば拒否する。
type ArchiveTicketTypeUseCase struct {
	repo repository.TicketRepository
}

func NewArchiveTicketTypeUseCase(r repository.TicketRepository) *ArchiveTicketTypeUseCase {
	return &ArchiveTicketTypeUseCase{repo: r}
}

type ArchiveTicketTypeInput struct {
	WorkspaceID string
	ProjectID   string
	TypeID      string
}

func (u *ArchiveTicketTypeUseCase) Execute(ctx context.Context, in ArchiveTicketTypeInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.TypeID == "" {
		return errors.New("workspaceID, projectID and typeID are required")
	}
	count, err := u.repo.CountActiveTicketsByType(ctx, in.WorkspaceID, in.ProjectID, in.TypeID)
	if err != nil {
		return err
	}
	if count > 0 {
		return ErrTicketTypeInUse
	}
	return u.repo.ArchiveTicketType(ctx, in.WorkspaceID, in.ProjectID, in.TypeID)
}

// RestoreTicketTypeUseCase はアーカイブ済み種別を現役へ戻す。position は末尾へ付け直す。
type RestoreTicketTypeUseCase struct {
	repo repository.TicketRepository
}

func NewRestoreTicketTypeUseCase(r repository.TicketRepository) *RestoreTicketTypeUseCase {
	return &RestoreTicketTypeUseCase{repo: r}
}

type RestoreTicketTypeInput struct {
	WorkspaceID string
	ProjectID   string
	TypeID      string
}

func (u *RestoreTicketTypeUseCase) Execute(ctx context.Context, in RestoreTicketTypeInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.TypeID == "" {
		return errors.New("workspaceID, projectID and typeID are required")
	}
	last, err := u.repo.LastActiveTicketTypePosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return err
	}
	return u.repo.RestoreTicketType(ctx, in.WorkspaceID, in.ProjectID, in.TypeID, pos)
}
