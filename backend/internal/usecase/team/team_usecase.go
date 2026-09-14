// Package team はプロジェクトのチームと、その所属を扱う。
//
// 担当（1 人・責任の所在）とは別の概念で、こちらは「どの塊の仕事か」を表す。
package team

import (
	"context"
	"errors"
	"strings"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// CreateTeamUseCase はプロジェクトにチームを 1 つ足す。
type CreateTeamUseCase struct {
	repo repository.TeamRepository
}

func NewCreateTeamUseCase(r repository.TeamRepository) *CreateTeamUseCase {
	return &CreateTeamUseCase{repo: r}
}

type CreateTeamInput struct {
	WorkspaceID string
	ProjectID   string
	Name        string
}

func (u *CreateTeamUseCase) Execute(ctx context.Context, in CreateTeamInput) (*domain.Team, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" {
		return nil, errors.New("workspaceID and projectID are required")
	}
	name := strings.TrimSpace(in.Name)
	if !domain.ValidTeamName(name) {
		return nil, domain.ErrInvalidTeamName
	}
	return u.repo.CreateTeam(ctx, in.WorkspaceID, in.ProjectID, name)
}

// ListTeamsUseCase はプロジェクトのチーム一覧。所属も詰めて返す
// （画面が 1 回で描けるように。チーム数はプロジェクトあたり数件の想定）。
type ListTeamsUseCase struct {
	repo repository.TeamRepository
}

func NewListTeamsUseCase(r repository.TeamRepository) *ListTeamsUseCase {
	return &ListTeamsUseCase{repo: r}
}

func (u *ListTeamsUseCase) Execute(ctx context.Context, workspaceID, projectID string) ([]domain.Team, error) {
	if workspaceID == "" || projectID == "" {
		return nil, errors.New("workspaceID and projectID are required")
	}
	teams, err := u.repo.ListTeams(ctx, workspaceID, projectID)
	if err != nil {
		return nil, err
	}
	for i := range teams {
		members, err := u.repo.ListTeamMembers(ctx, workspaceID, teams[i].ID)
		if err != nil {
			return nil, err
		}
		teams[i].Members = members
	}
	return teams, nil
}

// UpdateTeamUseCase はチーム名を書き換える。
type UpdateTeamUseCase struct {
	repo repository.TeamRepository
}

func NewUpdateTeamUseCase(r repository.TeamRepository) *UpdateTeamUseCase {
	return &UpdateTeamUseCase{repo: r}
}

type UpdateTeamInput struct {
	WorkspaceID string
	ProjectID   string
	TeamID      string
	Name        string
}

func (u *UpdateTeamUseCase) Execute(ctx context.Context, in UpdateTeamInput) (*domain.Team, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.TeamID == "" {
		return nil, errors.New("workspaceID, projectID and teamID are required")
	}
	name := strings.TrimSpace(in.Name)
	if !domain.ValidTeamName(name) {
		return nil, domain.ErrInvalidTeamName
	}
	return u.repo.UpdateTeam(ctx, in.WorkspaceID, in.ProjectID, in.TeamID, name)
}

// DeleteTeamUseCase はチームを消す。付いていたチケットは消えず、印だけが外れる。
//
// 外すのと消すのは 2 文になるので取引で包む。途中で落ちると「消えたチームの id が
// チケットに残る」状態になり、複合 FK が無効な組を指したまま残ってしまう。
type DeleteTeamUseCase struct {
	repo      repository.TeamRepository
	txManager repository.TxManager
}

func NewDeleteTeamUseCase(r repository.TeamRepository, tx repository.TxManager) *DeleteTeamUseCase {
	return &DeleteTeamUseCase{repo: r, txManager: tx}
}

func (u *DeleteTeamUseCase) Execute(ctx context.Context, workspaceID, projectID, teamID string) error {
	if workspaceID == "" || projectID == "" || teamID == "" {
		return errors.New("workspaceID, projectID and teamID are required")
	}
	return u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := u.repo.ClearTicketsTeam(ctx, workspaceID, teamID); err != nil {
			return err
		}
		return u.repo.DeleteTeam(ctx, workspaceID, projectID, teamID)
	})
}

// TeamMembershipUseCase は所属の付け外し。送るのは「切り替え」ではなく「どちらにしたいか」
// —— 二重に押されたときに意図せず外れるのを防ぐ（監視の付け外しと同じ流儀）。
type TeamMembershipUseCase struct {
	repo repository.TeamRepository
}

func NewTeamMembershipUseCase(r repository.TeamRepository) *TeamMembershipUseCase {
	return &TeamMembershipUseCase{repo: r}
}

type TeamMembershipInput struct {
	WorkspaceID string
	TeamID      string
	UserID      uint64
	Member      bool
}

func (u *TeamMembershipUseCase) Execute(ctx context.Context, in TeamMembershipInput) ([]domain.TeamMember, error) {
	if in.WorkspaceID == "" || in.TeamID == "" || in.UserID == 0 {
		return nil, errors.New("workspaceID, teamID and userID are required")
	}
	if in.Member {
		if err := u.repo.AddTeamMember(ctx, in.WorkspaceID, in.TeamID, in.UserID); err != nil {
			return nil, err
		}
	} else if err := u.repo.RemoveTeamMember(ctx, in.WorkspaceID, in.TeamID, in.UserID); err != nil {
		return nil, err
	}
	return u.repo.ListTeamMembers(ctx, in.WorkspaceID, in.TeamID)
}

// SetTicketTeamUseCase はチケットの担当チームを差し替える（空なら外す）。
type SetTicketTeamUseCase struct {
	repo repository.TeamRepository
}

func NewSetTicketTeamUseCase(r repository.TeamRepository) *SetTicketTeamUseCase {
	return &SetTicketTeamUseCase{repo: r}
}

type SetTicketTeamInput struct {
	WorkspaceID string
	TicketID    string
	// TeamID が空なら外す。
	TeamID string
}

func (u *SetTicketTeamUseCase) Execute(ctx context.Context, in SetTicketTeamInput) (*domain.Ticket, error) {
	if in.WorkspaceID == "" || in.TicketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	return u.repo.SetTicketTeam(ctx, in.WorkspaceID, in.TicketID, in.TeamID)
}
