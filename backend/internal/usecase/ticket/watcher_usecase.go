package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrInvalidStoryPoints は見積りが保存してよい範囲を外れている。handler は 400 に畳む。
var ErrInvalidStoryPoints = errors.New("invalid story points")

// WatchTicketUseCase はチケットの監視を付け外しする。
//
// 「担当」とは別物。担当は 1 人（責任の所在）、監視は何人でも（気にしている人）。
// 監視できるのは自分の分だけ —— 他人を勝手に監視者にする口は持たない（通知が飛ぶため）。
type WatchTicketUseCase struct {
	repo repository.TicketRepository
}

func NewWatchTicketUseCase(r repository.TicketRepository) *WatchTicketUseCase {
	return &WatchTicketUseCase{repo: r}
}

type WatchTicketInput struct {
	WorkspaceID string
	TicketID    string
	UserID      uint64
	// Watching が true なら監視する、false なら外す。
	Watching bool
}

// TicketWatchState は監視の状態（自分が監視しているか・全体で何人か）。
type TicketWatchState struct {
	Watching bool  `json:"watching"`
	Count    int64 `json:"count"`
}

func (u *WatchTicketUseCase) Execute(ctx context.Context, in WatchTicketInput) (*TicketWatchState, error) {
	if in.WorkspaceID == "" || in.TicketID == "" || in.UserID == 0 {
		return nil, errors.New("workspaceID, ticketID and userID are required")
	}
	// チケットが無ければ監視もできない（FK 違反を待たず、ここで 404 に落とす）。
	if _, err := u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return nil, err
	}
	if in.Watching {
		if err := u.repo.AddTicketWatcher(ctx, in.WorkspaceID, in.TicketID, in.UserID); err != nil {
			return nil, err
		}
	} else if err := u.repo.RemoveTicketWatcher(ctx, in.WorkspaceID, in.TicketID, in.UserID); err != nil {
		return nil, err
	}
	return u.state(ctx, in.WorkspaceID, in.TicketID, in.UserID)
}

// GetTicketWatchStateUseCase は画面の目印（監視中か・何人か）を返す。
type GetTicketWatchStateUseCase struct {
	repo repository.TicketRepository
}

func NewGetTicketWatchStateUseCase(r repository.TicketRepository) *GetTicketWatchStateUseCase {
	return &GetTicketWatchStateUseCase{repo: r}
}

func (u *GetTicketWatchStateUseCase) Execute(ctx context.Context, workspaceID, ticketID string, userID uint64) (*TicketWatchState, error) {
	if workspaceID == "" || ticketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	watching, err := u.repo.IsTicketWatchedBy(ctx, workspaceID, ticketID, userID)
	if err != nil {
		return nil, err
	}
	count, err := u.repo.CountTicketWatchers(ctx, workspaceID, ticketID)
	if err != nil {
		return nil, err
	}
	return &TicketWatchState{Watching: watching, Count: count}, nil
}

func (u *WatchTicketUseCase) state(ctx context.Context, workspaceID, ticketID string, userID uint64) (*TicketWatchState, error) {
	watching, err := u.repo.IsTicketWatchedBy(ctx, workspaceID, ticketID, userID)
	if err != nil {
		return nil, err
	}
	count, err := u.repo.CountTicketWatchers(ctx, workspaceID, ticketID)
	if err != nil {
		return nil, err
	}
	return &TicketWatchState{Watching: watching, Count: count}, nil
}
