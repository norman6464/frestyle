package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrTeamNotFound は対象のチームが無い（または別プロジェクトのもの）ときに返す。
var ErrTeamNotFound = errors.New("team not found")

// ErrTeamNameTaken は同じプロジェクトに同名のチームが既にあるときに返す。
var ErrTeamNameTaken = errors.New("team name taken")

// TeamRepository はプロジェクトのチームと、その所属の読み書き。
type TeamRepository interface {
	CreateTeam(ctx context.Context, workspaceID, projectID, name string) (*domain.Team, error)
	ListTeams(ctx context.Context, workspaceID, projectID string) ([]domain.Team, error)
	GetTeam(ctx context.Context, workspaceID, projectID, teamID string) (*domain.Team, error)
	UpdateTeam(ctx context.Context, workspaceID, projectID, teamID, name string) (*domain.Team, error)
	// ClearTicketsTeam はそのチームが付いているチケットから印を外す。
	// DeleteTeam の前に必ず呼ぶ（複合 FK に SET NULL が使えない理由は queries/team.sql）。
	ClearTicketsTeam(ctx context.Context, workspaceID, teamID string) error
	// DeleteTeam は消す。付いているチケットは ClearTicketsTeam で先に外してある前提。
	DeleteTeam(ctx context.Context, workspaceID, projectID, teamID string) error

	AddTeamMember(ctx context.Context, workspaceID, teamID string, userID uint64) error
	RemoveTeamMember(ctx context.Context, workspaceID, teamID string, userID uint64) error
	ListTeamMembers(ctx context.Context, workspaceID, teamID string) ([]domain.TeamMember, error)

	// SetTicketTeam はチケットの担当チームを差し替える（teamID が空なら外す）。
	// 別プロジェクトのチームは複合 FK が拒む。
	SetTicketTeam(ctx context.Context, workspaceID, ticketID, teamID string) (*domain.Ticket, error)
}
