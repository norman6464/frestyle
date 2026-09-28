package project

import (
	"context"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// WorkspaceFinder はワークスペースを ID で引く口。repository.KnowledgeBaseRepository が満たす
// （ワークスペースの行はナレッジと共有だが、この usecase が要るのはこの 1 つだけなので狭く受ける）。
type WorkspaceFinder interface {
	// FindWorkspaceByID はワークスペースを 1 件引く。無ければ ErrWorkspaceNotFound。
	FindWorkspaceByID(ctx context.Context, workspaceID string) (*domain.Workspace, error)
}

// ResolveProjectLocationUseCase は URL の /projects/{projectId}（テナントを出さない）から
// プロジェクトの居場所（ワークスペース）を特定する。テナント確定前の読みなので判定はしない。
// 呼び出し側は返ったワークスペースで必ず所属の判定を通すこと（kb の ResolvePageLocationUseCase・
// ticket の ResolveTicketLocationUseCase と同じ約束）。
type ResolveProjectLocationUseCase struct {
	projects   repository.ProjectRepository
	workspaces WorkspaceFinder
}

func NewResolveProjectLocationUseCase(
	projects repository.ProjectRepository, workspaces WorkspaceFinder,
) *ResolveProjectLocationUseCase {
	return &ResolveProjectLocationUseCase{projects: projects, workspaces: workspaces}
}

type ResolveProjectLocationOutput struct {
	Project   domain.Project
	Workspace domain.Workspace
}

func (u *ResolveProjectLocationUseCase) Execute(ctx context.Context, projectID string) (*ResolveProjectLocationOutput, error) {
	if projectID == "" {
		return nil, repository.ErrProjectNotFound
	}
	p, err := u.projects.FindProjectByIDAcrossWorkspaces(ctx, projectID)
	if err != nil {
		return nil, err
	}
	ws, err := u.workspaces.FindWorkspaceByID(ctx, p.WorkspaceID)
	if err != nil {
		return nil, err
	}
	// この id 経路は ResolveWorkspaceUseCase（slug 経路）を通らないため、停止判定をここでも行う。
	if !ws.IsActive {
		return nil, repository.ErrProjectNotFound
	}
	return &ResolveProjectLocationOutput{Project: *p, Workspace: *ws}, nil
}
