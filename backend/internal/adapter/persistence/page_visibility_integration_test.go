//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pages.visibility='private' は、grants ベースの権限（ワークスペースとスペースの 2 段の付与を
// 足し合わせ、打ち消しは一切持たない）の唯一の例外で、作成者以外には既存の付与を問わず一切見せない
// （domain.PagePermissionFacts.IsOwner / domain.ResolvePagePermission / ResolvePageView 参照）。
//
// 権限を決める経路は 1 ページの解決（ResolvePagePermissionFacts）・一覧
// （ListSpacePageViewFacts）・サブツリー一括検査（ListSubtreePagePermissionFacts）の 3 つに
// 分かれており、1 つでも私設ページの絞りを見落とすと「一覧には出ないのに開ける」というずれに
// なる。ここではその 3 経路すべてを実 PostgreSQL で固定する。
func TestPageVisibility_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("作成者以外はスペースのadmin付与があっても一切見えない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		bob := f.principalFor(ctx, t, f.bob)
		// alice 自身の閲覧は（作成者かどうかとは無関係に）スペースの既定の付与から届く
		// （このシステムに「作成者だから見える」という特別扱いは無い — 唯一の例外は
		// private のときの IsOwner 判定だけで、それ以外は他の全員と同じ grants の合成を通る）。
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleAdmin)

		page, err := f.pageUC.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, Title: "個人的な下書き", CreatedByUserID: f.alice,
		})
		require.NoError(t, err)

		// bob にもページが置かれたスペースの admin を張る（ページ単位の付与は無いので、
		// 作成者以外へ届く付与としてはこれが最も強い）。
		f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleAdmin)

		// private にする前は、張った admin どおりに bob も編集できる（前提の確認）。
		before := f.permFor(ctx, t, page.ID, f.bob)
		require.True(t, before.CanEdit, "前提: private にする前は bob も編集できる")

		_, err = f.pages.UpdatePageVisibility(ctx, f.ws, page.ID, domain.PageVisibilityPrivate)
		require.NoError(t, err)

		// --- 1 ページの解決 ---
		aliceAfter := f.permFor(ctx, t, page.ID, f.alice)
		assert.True(t, aliceAfter.CanView, "作成者本人は private でも変わらず見える")
		assert.True(t, aliceAfter.CanEdit)

		bobAfter := f.permFor(ctx, t, page.ID, f.bob)
		assert.False(t, bobAfter.CanView, "admin 付与があるのに private で閉じられていない")
		assert.False(t, bobAfter.CanEdit)
		assert.False(t, bobAfter.CanComment)

		// --- 一覧（ListViewablePagesUseCase 経由。domain.ResolvePageView を通る） ---
		assert.Contains(t, f.viewablePageIDs(ctx, t, f.spaceA, f.alice), page.ID,
			"作成者の一覧には private でも出る")
		assert.NotContains(t, f.viewablePageIDs(ctx, t, f.spaceA, f.bob), page.ID,
			"admin 付与があるのに一覧に出てしまっている")

		// --- サブツリー一括検査（アーカイブ等の入口検査。ListSubtreePagePermissionFacts） ---
		_, err = f.pageUC.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, ParentID: &page.ID, Title: "下書きの子", CreatedByUserID: f.alice,
		})
		require.NoError(t, err)
		canEditSubtree := kb.NewCanEditPageSubtreeUseCase(f.perm)
		aliceCanEdit, err := canEditSubtree.Execute(ctx, kb.CanEditPageSubtreeInput{
			WorkspaceID: f.ws, PageID: page.ID, UserID: f.alice,
		})
		require.NoError(t, err)
		assert.True(t, aliceCanEdit, "作成者はサブツリーごと編集できる")
		bobCanEdit, err := canEditSubtree.Execute(ctx, kb.CanEditPageSubtreeInput{
			WorkspaceID: f.ws, PageID: page.ID, UserID: f.bob,
		})
		require.NoError(t, err)
		assert.False(t, bobCanEdit, "admin 付与があるのにサブツリー検査を通ってしまっている")
	})

	t.Run("publicとspaceは閲覧可否を一切変えない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		bob := f.principalFor(ctx, t, f.bob)
		f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleViewer)

		page, err := f.pageUC.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, Title: "普通のページ", CreatedByUserID: f.alice,
		})
		require.NoError(t, err)

		// 既定は 'space'。bob はスペースの viewer 付与どおりに見える。
		base := f.permFor(ctx, t, page.ID, f.bob)
		require.True(t, base.CanView, "前提: スペース既定で見える")

		_, err = f.pages.UpdatePageVisibility(ctx, f.ws, page.ID, domain.PageVisibilityPublic)
		require.NoError(t, err)
		afterPublic := f.permFor(ctx, t, page.ID, f.bob)
		assert.Equal(t, base, afterPublic, "'public' への変更で閲覧可否が変わってしまっている")
	})

	t.Run("存在しないページ・アーカイブ済みページはErrPageNotFound", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)

		_, err := f.pages.UpdatePageVisibility(ctx, f.ws, "0198a000-0000-7000-8000-0000000000ff", domain.PageVisibilityPrivate)
		require.ErrorIs(t, err, repository.ErrPageNotFound, "存在しないページ")

		page, err := f.pageUC.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, Title: "アーカイブ予定", CreatedByUserID: f.alice,
		})
		require.NoError(t, err)
		require.NoError(t, f.pages.ArchivePageSubtree(ctx, f.ws, page.ID))

		_, err = f.pages.UpdatePageVisibility(ctx, f.ws, page.ID, domain.PageVisibilityPrivate)
		require.ErrorIs(t, err, repository.ErrPageNotFound, "アーカイブ済みページ")
	})
}
