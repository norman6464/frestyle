package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrSprintNotFound はスプリントが無い（または見る権限が無い）。handler は 404 に畳む。
var ErrSprintNotFound = errors.New("sprint not found")

// ErrSprintTicketNotFound はそのチケットがどのスプリントにも入っていない。
var ErrSprintTicketNotFound = errors.New("sprint ticket not found")

// SprintTicketRank はスプリント内に置かれたチケット 1 件の位置。
type SprintTicketRank struct {
	SprintID string
	TicketID string
	Position string
}

// SprintRepository はスプリントと、その中のチケットの並びを扱う。
//
// チケット側の repository とは分けてある。スプリントはバックログの並び（ticket_backlog_ranks）
// とは別の文脈で、同じ表を共有しない —— 文脈ごとに表を分ける方針（schema.hcl の
// ticket_backlog_ranks のコメント参照）を、層の切り方にも合わせる。
type SprintRepository interface {
	CreateSprint(ctx context.Context, s *domain.Sprint) error
	FindSprint(ctx context.Context, workspaceID, sprintID string) (*domain.Sprint, error)
	ListSprints(ctx context.Context, workspaceID, projectID string) ([]domain.Sprint, error)
	LastSprintPosition(ctx context.Context, workspaceID, projectID string) (string, error)
	UpdateSprint(ctx context.Context, workspaceID, sprintID, name string, startDate, endDate *string) (*domain.Sprint, error)
	ChangeSprintState(ctx context.Context, workspaceID, sprintID string, state domain.SprintState) (*domain.Sprint, error)
	DeleteSprint(ctx context.Context, workspaceID, sprintID string) error
	// CountActiveSprints は「進行中は 1 つまで」の判定に使う（DB の制約ではなく usecase の規則）。
	CountActiveSprints(ctx context.Context, workspaceID, projectID string) (int64, error)

	// AddTicketToSprint は既に別のスプリントへ入っていれば移動になる（表の PK が
	// (workspace_id, ticket_id) なので、1 件は同時に 1 つのスプリントにしか入らない）。
	AddTicketToSprint(ctx context.Context, workspaceID, sprintID, ticketID, position string) error
	RemoveTicketFromSprint(ctx context.Context, workspaceID, ticketID string) error
	LastTicketSprintRankPosition(ctx context.Context, workspaceID, sprintID string) (string, error)
	ListSprintTicketIDs(ctx context.Context, workspaceID, sprintID string) ([]string, error)
	// ListSprintTicketRanks はスプリント内の並び（ticket_id と position の組）。
	// 並べ替えで「隣の前後へ何を挟むか」を決めるのに使う。
	ListSprintTicketRanks(ctx context.Context, workspaceID, sprintID string) ([]SprintTicketRank, error)
	// FindTicketSprint はそのチケットが入っているスプリント。入っていなければ
	// ErrSprintTicketNotFound。
	FindTicketSprint(ctx context.Context, workspaceID, ticketID string) (*SprintTicketRank, error)
	MoveTicketSprintRank(ctx context.Context, workspaceID, ticketID, position string) error
	CountSprintTickets(ctx context.Context, workspaceID, sprintID string) (int64, error)
}
