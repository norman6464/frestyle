// Package ticket はチケット（仕事 1 件を追いかける記録）の usecase 層。
// backend/internal/usecase/<domain> の 1 つ（kb とは対等な別の境界。usecase/kb を import しない）。
package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// CheckTicketPermissionUseCase は「このユーザーはこのチケットで何ができるか」に答える。
//
// チケットの実効権限は **ワークスペース単位**。バックログはナレッジのスペースから独立した
// 製品で、スペースの付与（space_grants）を引くと「ナレッジが見えない人はバックログも見えない」
// という要らない結び付きが権限側から復活する。プロジェクト固有の権限表は今は持たない。
//
// FindTicket は権限のためではなく実在の確認のために呼ぶ。チケットが実在しない・別ワークス
// ペースなら repository.ErrTicketNotFound をそのまま伝え、権限が無いことと存在しないことを
// 区別しない。
type CheckTicketPermissionUseCase struct {
	tickets repository.TicketRepository
	perms   repository.KnowledgeBasePermissionRepository
}

func NewCheckTicketPermissionUseCase(
	tickets repository.TicketRepository, perms repository.KnowledgeBasePermissionRepository,
) *CheckTicketPermissionUseCase {
	return &CheckTicketPermissionUseCase{tickets: tickets, perms: perms}
}

type CheckTicketPermissionInput struct {
	WorkspaceID string
	TicketID    string
	UserID      uint64
}

func (u *CheckTicketPermissionUseCase) Execute(
	ctx context.Context, in CheckTicketPermissionInput,
) (*domain.ScopePermission, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if _, err := u.tickets.FindTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return nil, err
	}
	facts, err := u.perms.WorkspacePermissionFactsForUser(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	perm := domain.ResolveScopePermission(*facts)
	return &perm, nil
}

// ResolveTicketKeyUseCase は表示キー（例 FRESTYLE-12）から ticket_id を解決する。分解できない・
// 非実在はどちらも repository.ErrTicketNotFound に畳み、フォーマット違反で存在の有無を漏らさない。
type ResolveTicketKeyUseCase struct {
	tickets repository.TicketRepository
}

func NewResolveTicketKeyUseCase(tickets repository.TicketRepository) *ResolveTicketKeyUseCase {
	return &ResolveTicketKeyUseCase{tickets: tickets}
}

type ResolveTicketKeyInput struct {
	WorkspaceID string
	Key         string
}

func (u *ResolveTicketKeyUseCase) Execute(ctx context.Context, in ResolveTicketKeyInput) (string, error) {
	if in.WorkspaceID == "" {
		return "", errors.New("workspaceID is required")
	}
	projectKey, number, ok := domain.ParseTicketKey(in.Key)
	if !ok {
		return "", repository.ErrTicketNotFound
	}
	return u.tickets.ResolveTicketIDByKey(ctx, in.WorkspaceID, projectKey, number)
}

// ResolveTicketLocationUseCase は URL の /kb/tickets/{ticketId} からチケットの属する
// ワークスペースを決める。テナント確定前の読み取りなので、呼び出し側は返ったワークスペースで
// 必ず権限判定を通してから使うこと（kb の ResolvePageLocationUseCase と同じ約束）。ticket_id は
// 全テナントで一意な uuid なので、引くこと自体は越境にならない。
type ResolveTicketLocationUseCase struct {
	tickets    repository.TicketRepository
	workspaces repository.KnowledgeBaseRepository
}

func NewResolveTicketLocationUseCase(
	tickets repository.TicketRepository, workspaces repository.KnowledgeBaseRepository,
) *ResolveTicketLocationUseCase {
	return &ResolveTicketLocationUseCase{tickets: tickets, workspaces: workspaces}
}

// ResolveTicketLocationOutput は解決したワークスペース。画面は slug を受け取って
// 以降の API 呼び出しに使う（URL にワークスペースを出さない既存の規則）。
type ResolveTicketLocationOutput struct {
	Workspace domain.Workspace
}

func (u *ResolveTicketLocationUseCase) Execute(ctx context.Context, ticketID string) (*ResolveTicketLocationOutput, error) {
	if ticketID == "" {
		return nil, repository.ErrTicketNotFound
	}
	workspaceID, err := u.tickets.FindTicketWorkspaceID(ctx, ticketID)
	if err != nil {
		return nil, err
	}
	ws, err := u.workspaces.FindWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	// 停止中のワークスペースは無いものとして扱う。slug 経路（ResolveWorkspaceUseCase）と同じ判定だが
	// この id 経路はそこを通らないため、ここで見ないと停止後も id 経由で読み続けられてしまう。
	if !ws.IsActive {
		return nil, repository.ErrTicketNotFound
	}
	return &ResolveTicketLocationOutput{Workspace: *ws}, nil
}
