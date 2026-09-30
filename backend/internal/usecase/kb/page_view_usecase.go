package kb

import (
	"context"
	"errors"
	"log/slog"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// recentPagesLimit は「最近見たページ」として返す最終的な件数。
const recentPagesLimit = 10

// RecordPageViewUseCase は「このページを見た」を記録し、そのページの閲覧数
// （= 見たことのある人数）を返す。呼び出し元（KnowledgeBasePageHandler.ResolveByID）は
// CanView が確かめられた後にだけこれを呼ぶこと。
type RecordPageViewUseCase struct {
	repo repository.PageViewRepository
}

func NewRecordPageViewUseCase(r repository.PageViewRepository) *RecordPageViewUseCase {
	return &RecordPageViewUseCase{repo: r}
}

func (u *RecordPageViewUseCase) Execute(ctx context.Context, workspaceID, pageID string, userID uint64) (viewCount int, err error) {
	if err := u.repo.RecordView(ctx, workspaceID, pageID, userID); err != nil {
		return 0, err
	}
	return u.repo.CountViews(ctx, pageID)
}

// ListMyRecentPagesUseCase は自分が最近見たページを、可視判定でふるってから
// viewed_at の新しい順に返す（ワークスペース横断）。
//
// ふるいは 1 ページずつ CheckPagePermissionUseCase を呼ぶ（ListViewablePagesUseCase のような
// 1 クエリのバルック判定は使わない）。候補は repository 側で頭打ちにした少数（数十件）で、
// スペース内の全ページを相手にする一覧とは規模が違う — この件数なら 1 往復ずつでも
// 遅くならず、ワークスペースをまたぐ候補を一括で判定する仕組みを新たに作る理由が無い。
type ListMyRecentPagesUseCase struct {
	views repository.PageViewRepository
	check *CheckPagePermissionUseCase
}

func NewListMyRecentPagesUseCase(views repository.PageViewRepository, check *CheckPagePermissionUseCase) *ListMyRecentPagesUseCase {
	return &ListMyRecentPagesUseCase{views: views, check: check}
}

func (u *ListMyRecentPagesUseCase) Execute(ctx context.Context, userID uint64) ([]domain.RecentPage, error) {
	if userID == 0 {
		return nil, errors.New("userID is required")
	}
	candidates, err := u.views.ListRecentPageViewCandidates(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.RecentPage, 0, recentPagesLimit)
	for _, c := range candidates {
		perm, err := u.check.Execute(ctx, CheckPagePermissionInput{
			WorkspaceID: c.WorkspaceID,
			PageID:      c.PageID,
			UserID:      userID,
		})
		if err != nil {
			// 1 件の解決に失敗しても一覧全体は止めない（ancestors/cover と同じ扱い）。
			slog.WarnContext(ctx, "kb: recent page permission check failed", "pageID", c.PageID, "err", err)
			continue
		}
		if !perm.CanView {
			continue
		}
		out = append(out, c)
		if len(out) >= recentPagesLimit {
			break
		}
	}
	return out, nil
}
