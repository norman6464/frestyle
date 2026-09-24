package kb_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const (
	kbPrincipal = "0198a000-0000-7000-8000-00000000000a"
	kbGroup     = "0198a000-0000-7000-8000-00000000000b"
)

func kbGrantRole(r domain.GrantRole) *domain.GrantRole { return &r }

func Test_ページ権限確認_必須項目の検証(t *testing.T) {
	uc := kb.NewCheckPagePermissionUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.CheckPagePermissionInput{PageID: kbPage, UserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.CheckPagePermissionInput{WorkspaceID: kbWS, UserID: 1})
	require.Error(t, err, "pageID 必須")
	_, err = uc.Execute(ctx, kb.CheckPagePermissionInput{WorkspaceID: kbWS, PageID: kbPage})
	require.Error(t, err, "userID 必須")
}

func Test_ページ権限確認_集めた事実を規則にかけて返す(t *testing.T) {
	// 権限は 3 段の付与（ワークスペース / スペース / ページ）を足し合わせ、届いた中で
	// 最も強い役割だけで決まる。usecase は集めた事実をそのまま domain の規則へ渡し、
	// 可否の出し方をここに写経しない。
	cases := map[string]struct {
		role                        *domain.GrantRole
		canView, canEdit, canManage bool
	}{
		"役割がひとつも届いていない": {role: nil},
		"閲覧だけ届いている":     {role: kbGrantRole(domain.GrantRoleViewer), canView: true},
		"編集まで届いている":     {role: kbGrantRole(domain.GrantRoleEditor), canView: true, canEdit: true},
		"権限も変えられる": {
			role: kbGrantRole(domain.GrantRoleAdmin), canView: true, canEdit: true, canManage: true,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			repo := &mockKBPermissionRepo{}
			repo.On("PagePermissionFactsForUser", mock.Anything, kbWS, kbPage, uint64(1)).
				Return(&domain.PagePermissionFacts{Member: true, Role: tc.role}, nil)

			got, err := kb.NewCheckPagePermissionUseCase(repo).
				Execute(context.Background(), kb.CheckPagePermissionInput{
					WorkspaceID: kbWS, PageID: kbPage, UserID: 1,
				})
			require.NoError(t, err)
			assert.Equal(t, tc.canView, got.CanView)
			assert.Equal(t, tc.canEdit, got.CanEdit)
			assert.Equal(t, tc.canManage, got.CanManage)
		})
	}
}

func Test_ページ権限確認_ページが無ければそのまま伝える(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("PagePermissionFactsForUser", mock.Anything, kbWS, kbPage, uint64(1)).
		Return(nil, repository.ErrPageNotFound)
	uc := kb.NewCheckPagePermissionUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.CheckPagePermissionInput{
		WorkspaceID: kbWS, PageID: kbPage, UserID: 1,
	})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
}

func Test_ワークスペース所属判定(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("IsWorkspaceMember", mock.Anything, kbWS, uint64(1)).Return(true, nil)
	uc := kb.NewIsWorkspaceMemberUseCase(repo)

	ok, err := uc.Execute(context.Background(), kb.IsWorkspaceMemberInput{WorkspaceID: kbWS, UserID: 1})
	require.NoError(t, err)
	assert.True(t, ok)

	_, err = uc.Execute(context.Background(), kb.IsWorkspaceMemberInput{UserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(context.Background(), kb.IsWorkspaceMemberInput{WorkspaceID: kbWS})
	require.Error(t, err, "userID 必須")
}

func Test_閲覧可能ページ一覧_見えないページを落とす(t *testing.T) {
	visible := domain.Page{ID: "p1", WorkspaceID: kbWS, SpaceID: kbSpace, Title: "見える"}
	hidden := domain.Page{ID: "p2", WorkspaceID: kbWS, SpaceID: kbSpace, Title: "隠れる"}
	repo := &mockKBPermissionRepo{}
	repo.On("ListSpacePageViewFacts", mock.Anything, kbWS, kbSpace, uint64(1), false).
		Return([]repository.PageWithViewFacts{
			{Page: visible, Role: kbGrantRole(domain.GrantRoleViewer)},
			// 見えない行 ＝ 役割がひとつも届いていないページ。private なスペースで、
			// ある枝にだけページ付与で届いているときに起こる（付与は下へ降りるだけ）。
			{Page: hidden, Role: nil},
		}, nil)
	uc := kb.NewListViewablePagesUseCase(repo)

	out, err := uc.Execute(context.Background(), kb.ListViewablePagesInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1,
	})
	require.NoError(t, err)
	require.Len(t, out.Pages, 1)
	assert.Equal(t, "見える", out.Pages[0].Title)
	assert.True(t, out.HasHiddenChildren[kb.HiddenChildrenRootKey],
		"落とした分は「在る」とだけ残す（枚数も題名も出さない）")
}

func Test_閲覧可能ページ一覧_見えない親の下は数えない(t *testing.T) {
	// 見える根 a ─ 見えない根 b ─ b の下に 2 枚（見えるものと見えないもの）。
	//
	// これは本番でも起こる形。スペース全体には役割が届いておらず、a と orphan にだけ
	// ページ付与で届いている状態を写している（付与は張ったページから下へ降りるだけで、
	// 祖先には届かない。だから orphan は見えて親の b は見えない）。
	//
	// b が見えないので、その配下は木に出ない（PageTreeOrphanHidden）。ここで b の直下を
	// 数えてしまうと「見えない枝の中に何枚あるか」が漏れ、木から伏せた判断と食い違う。
	b := "b"
	rows := []repository.PageWithViewFacts{
		{
			Page: domain.Page{ID: "a", WorkspaceID: kbWS, SpaceID: kbSpace, Title: "見える根"},
			Role: kbGrantRole(domain.GrantRoleViewer),
		},
		{
			Page: domain.Page{ID: b, WorkspaceID: kbWS, SpaceID: kbSpace, Title: "見えない根"},
		},
		{
			// 自分には役割が届いているが、親が見えないので木には出ない（＝孤児）。
			Page: domain.Page{ID: "orphan", WorkspaceID: kbWS, SpaceID: kbSpace, ParentID: &b, Title: "見えるが孤児"},
			Role: kbGrantRole(domain.GrantRoleViewer),
		},
		{
			Page: domain.Page{ID: "buried", WorkspaceID: kbWS, SpaceID: kbSpace, ParentID: &b, Title: "見えない孫"},
		},
	}
	repo := &mockKBPermissionRepo{}
	repo.On("ListSpacePageViewFacts", mock.Anything, kbWS, kbSpace, uint64(1), false).Return(rows, nil)

	out, err := kb.NewListViewablePagesUseCase(repo).
		Execute(context.Background(), kb.ListViewablePagesInput{WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1})
	require.NoError(t, err)

	assert.True(t, out.HasHiddenChildren[kb.HiddenChildrenRootKey], "スペース直下で伏せた分は知らせる")
	assert.False(t, out.HasHiddenChildren[b], "見えない親の直下は、伏せた孫が居ても知らせない")
	assert.Len(t, out.Pages, 2, "見える根と孤児。孤児を落とすのは木の組み立て側の役目")
}

func Test_閲覧可能ページ一覧_見える親の直下で伏せた分は知らせる(t *testing.T) {
	// **本番では起こらない形を手で組んで、印の付け先だけを確かめる。**
	// 役割は木を下るほど弱くならない（親へ届いた役割は子孫にも届き、親子でスペースも
	// 揃う）ので、「親は見えるのに子は見えない」は事実を集めるクエリからは出てこない。
	// それでも印を親の ID に付けるという取り決めは固定しておきたいので、事実を直接置く。
	rows := []repository.PageWithViewFacts{
		{
			Page: domain.Page{ID: "root", WorkspaceID: kbWS, SpaceID: kbSpace, Title: "見える親"},
			Role: kbGrantRole(domain.GrantRoleViewer),
		},
		{
			Page: domain.Page{ID: "child", WorkspaceID: kbWS, SpaceID: kbSpace, ParentID: strPtr("root"), Title: "見えない子"},
		},
	}
	repo := &mockKBPermissionRepo{}
	repo.On("ListSpacePageViewFacts", mock.Anything, kbWS, kbSpace, uint64(1), false).Return(rows, nil)

	out, err := kb.NewListViewablePagesUseCase(repo).
		Execute(context.Background(), kb.ListViewablePagesInput{WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1})
	require.NoError(t, err)

	assert.Len(t, out.Pages, 1)
	assert.True(t, out.HasHiddenChildren["root"], "伏せた分は親の ID に印を付ける")
	assert.False(t, out.HasHiddenChildren[kb.HiddenChildrenRootKey], "スペース直下では伏せていない")
}

func Test_閲覧可能ページ一覧_見える根が無いなら有無も返さない(t *testing.T) {
	// 根には役割が届いておらず、その子にだけページ付与で届いている形
	// （付与は張ったページから下へ降りるだけで、祖先には届かない）。
	//
	// 子は「見える」ので pages には入るが、親が見えないので木には繋がらず
	// （BuildPageTree の PageTreeOrphanHidden が落とす）、画面には 1 行も出ない。
	// このとき有無を返すと、応答が {"pages":[],"hasHiddenChildren":true} になり、
	// 存在しないスペースの {"pages":[],"hasHiddenChildren":false} と撃ち分けられる。
	root := domain.Page{ID: "root", WorkspaceID: kbWS, SpaceID: kbSpace, Title: "見えない根"}
	child := domain.Page{ID: "child", WorkspaceID: kbWS, SpaceID: kbSpace, ParentID: strPtr("root"), Title: "見える子"}

	repo := &mockKBPermissionRepo{}
	repo.On("ListSpacePageViewFacts", mock.Anything, kbWS, kbSpace, uint64(1), false).
		Return([]repository.PageWithViewFacts{
			{Page: root},
			{Page: child, Role: kbGrantRole(domain.GrantRoleViewer)},
		}, nil)

	out, err := kb.NewListViewablePagesUseCase(repo).
		Execute(context.Background(), kb.ListViewablePagesInput{WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1})
	require.NoError(t, err)

	assert.Len(t, out.Pages, 1, "子は見えるので一覧には入る（木から落とすのは組み立て側の役目）")
	assert.Empty(t, out.HasHiddenChildren, "画面に 1 行も出ないので、印は返さない")
}

func Test_閲覧可能ページ一覧_1件も見えないなら有無も返さない(t *testing.T) {
	// 存在しないスペースと「中身が 1 件も見えないスペース」を撃ち分けないための不変条件。
	// 有無を返すと、前者は false・後者は true になり、スペース ID の総当たりで実在が分かる。
	// 自分が入っていない private スペース ＝ どの行にも役割が届いていない。
	repo := &mockKBPermissionRepo{}
	repo.On("ListSpacePageViewFacts", mock.Anything, kbWS, kbSpace, uint64(1), false).
		Return([]repository.PageWithViewFacts{
			{Page: domain.Page{ID: "p1", WorkspaceID: kbWS, SpaceID: kbSpace}},
			{Page: domain.Page{ID: "p2", WorkspaceID: kbWS, SpaceID: kbSpace}},
		}, nil)

	out, err := kb.NewListViewablePagesUseCase(repo).
		Execute(context.Background(), kb.ListViewablePagesInput{WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1})
	require.NoError(t, err)

	assert.Empty(t, out.Pages)
	assert.Empty(t, out.HasHiddenChildren, "存在しないスペースの応答と 1 バイトも変わらないこと")
}

func Test_閲覧可能ページ一覧_必須項目の検証(t *testing.T) {
	uc := kb.NewListViewablePagesUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.ListViewablePagesInput{SpaceID: kbSpace, UserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.ListViewablePagesInput{WorkspaceID: kbWS, UserID: 1})
	require.Error(t, err, "spaceID 必須")
	_, err = uc.Execute(ctx, kb.ListViewablePagesInput{WorkspaceID: kbWS, SpaceID: kbSpace})
	require.Error(t, err, "userID 必須")
}

func Test_サブツリー編集可否_必須項目の検証(t *testing.T) {
	uc := kb.NewCanEditPageSubtreeUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.CanEditPageSubtreeInput{PageID: kbPage, UserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.CanEditPageSubtreeInput{WorkspaceID: kbWS, UserID: 1})
	require.Error(t, err, "pageID 必須")
	_, err = uc.Execute(ctx, kb.CanEditPageSubtreeInput{WorkspaceID: kbWS, PageID: kbPage})
	require.Error(t, err, "userID 必須")
}

func Test_サブツリー編集可否_1枚でも編集できなければ不可(t *testing.T) {
	// **子孫だけ弱い行は、本番では作れない形を手で組んでいる。**
	// 役割は 3 段の付与を足し合わせた「最も強いもの」で決まり、子孫の経路は親の経路を
	// 必ず含むので、根を編集できるなら全子孫も編集できる。それでもこの検査を残すのは、
	// 事実を集めるクエリが経路を取り違えた（祖先ではなく子孫を辿った等）ときに、
	// 根 1 枚だけ見て通す実装では気づけないため。ここは事実を直接置いて、
	// 1 枚でも欠けたら断ることを固定する。
	editable := domain.PagePermissionFacts{Member: true, Role: kbGrantRole(domain.GrantRoleEditor)}
	cases := map[string]struct {
		rows []repository.PageWithPermissionFacts
		want bool
	}{
		"全部編集できる": {
			rows: []repository.PageWithPermissionFacts{
				{PageID: kbPage, Facts: editable},
				{PageID: kbPage + "1", Facts: editable},
			},
			want: true,
		},
		"子孫には閲覧しか届いていない": {
			rows: []repository.PageWithPermissionFacts{
				{PageID: kbPage, Facts: editable},
				{PageID: kbPage + "1", Facts: domain.PagePermissionFacts{
					Member: true, Role: kbGrantRole(domain.GrantRoleViewer),
				}},
			},
			want: false,
		},
		"子孫には役割がひとつも届いていない": {
			rows: []repository.PageWithPermissionFacts{
				{PageID: kbPage, Facts: editable},
				{PageID: kbPage + "1", Facts: domain.PagePermissionFacts{Member: true}},
			},
			want: false,
		},
		"1 行も返らない（ページが無い）": {
			rows: []repository.PageWithPermissionFacts{},
			want: false,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			repo := &mockKBPermissionRepo{}
			repo.On("ListSubtreePagePermissionFacts", mock.Anything, kbWS, kbPage, uint64(1)).
				Return(tc.rows, nil)
			uc := kb.NewCanEditPageSubtreeUseCase(repo)

			got, err := uc.Execute(context.Background(), kb.CanEditPageSubtreeInput{
				WorkspaceID: kbWS, PageID: kbPage, UserID: 1,
			})
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func Test_サブツリー編集可否_事実の収集が失敗したら伝える(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("ListSubtreePagePermissionFacts", mock.Anything, kbWS, kbPage, uint64(1)).
		Return(nil, repository.ErrPageNotFound)
	uc := kb.NewCanEditPageSubtreeUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.CanEditPageSubtreeInput{
		WorkspaceID: kbWS, PageID: kbPage, UserID: 1,
	})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
	assert.False(t, got, "確認できないなら許可に倒さない")
}

func Test_メンバー削除_所属を終える(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("LeaveWorkspaceMembership", mock.Anything, kbWS, uint64(7), uint64(1)).Return(nil)
	uc := kb.NewRemoveWorkspaceMemberUseCase(repo)

	require.NoError(t, uc.Execute(context.Background(), kb.RemoveWorkspaceMemberInput{
		WorkspaceID: kbWS, UserID: 7, ActorUserID: 1,
	}))
	repo.AssertExpectations(t)
}

func Test_グループ作成_名前の検証(t *testing.T) {
	uc := kb.NewCreatePrincipalGroupUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.CreatePrincipalGroupInput{WorkspaceID: kbWS})
	require.Error(t, err, "name 必須")
	_, err = uc.Execute(ctx, kb.CreatePrincipalGroupInput{WorkspaceID: kbWS, Name: strings.Repeat("あ", 201)})
	require.Error(t, err, "name は 200 文字まで")
	_, err = uc.Execute(ctx, kb.CreatePrincipalGroupInput{Name: "開発"})
	require.Error(t, err, "workspaceID 必須")
}

func Test_グループ所属追加_グループでない主体は拒否(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindPrincipal", mock.Anything, kbWS, kbGroup).
		Return(&domain.Principal{ID: kbGroup, WorkspaceID: kbWS, Kind: domain.PrincipalKindUser}, nil)
	uc := kb.NewAddGroupMemberUseCase(repo)

	err := uc.Execute(context.Background(), kb.AddGroupMemberInput{
		WorkspaceID: kbWS, GroupPrincipalID: kbGroup, MemberUserID: 7,
	})
	require.ErrorIs(t, err, kb.ErrPrincipalKindMismatch)
	repo.AssertNotCalled(t, "AddGroupMember", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_グループ所属追加_非メンバーは加えられない(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindPrincipal", mock.Anything, kbWS, kbGroup).
		Return(&domain.Principal{ID: kbGroup, WorkspaceID: kbWS, Kind: domain.PrincipalKindGroup, Name: "開発"}, nil)
	repo.On("FindUserPrincipal", mock.Anything, kbWS, uint64(7)).Return(nil, repository.ErrPrincipalNotFound)
	uc := kb.NewAddGroupMemberUseCase(repo)

	err := uc.Execute(context.Background(), kb.AddGroupMemberInput{
		WorkspaceID: kbWS, GroupPrincipalID: kbGroup, MemberUserID: 7,
	})
	require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
}

func Test_グループ所属削除_非メンバーなら何もしない(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindUserPrincipal", mock.Anything, kbWS, uint64(7)).Return(nil, repository.ErrPrincipalNotFound)
	uc := kb.NewRemoveGroupMemberUseCase(repo)

	require.NoError(t, uc.Execute(context.Background(), kb.RemoveGroupMemberInput{
		WorkspaceID: kbWS, GroupPrincipalID: kbGroup, MemberUserID: 7,
	}))
	repo.AssertNotCalled(t, "RemoveGroupMember", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_スペース全員の主体_必須項目の検証(t *testing.T) {
	uc := kb.NewEnsureSpaceEveryonePrincipalUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.EnsureSpaceEveryonePrincipalInput{SpaceID: kbSpace})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.EnsureSpaceEveryonePrincipalInput{WorkspaceID: kbWS})
	require.Error(t, err, "spaceID 必須")
}

func Test_権限付与_役割の検証(t *testing.T) {
	ctx := context.Background()

	wsUC := kb.NewGrantWorkspaceRoleUseCase(&mockKBPermissionRepo{})
	_, err := wsUC.Execute(ctx, kb.GrantWorkspaceRoleInput{
		WorkspaceID: kbWS, PrincipalID: kbPrincipal, Role: domain.GrantRole("owner"),
	})
	require.ErrorIs(t, err, kb.ErrInvalidGrantRole)

	spUC := kb.NewGrantSpaceRoleUseCase(&mockKBPermissionRepo{})
	_, err = spUC.Execute(ctx, kb.GrantSpaceRoleInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, PrincipalID: kbPrincipal, Role: domain.GrantRole(""),
	})
	require.ErrorIs(t, err, kb.ErrInvalidGrantRole)
}

func Test_権限付与_別ワークスペースの主体は拒否(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindPrincipal", mock.Anything, kbWS, kbPrincipal).Return(nil, repository.ErrPrincipalNotFound)
	uc := kb.NewGrantSpaceRoleUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.GrantSpaceRoleInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, PrincipalID: kbPrincipal, Role: domain.GrantRoleEditor,
	})
	require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
	repo.AssertNotCalled(t, "UpsertSpaceGrant", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_権限付与_ワークスペースとスペースの両方に張れる(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindPrincipal", mock.Anything, kbWS, kbPrincipal).
		Return(&domain.Principal{ID: kbPrincipal, WorkspaceID: kbWS, Kind: domain.PrincipalKindUser}, nil)
	repo.On("UpsertWorkspaceGrant", mock.Anything, kbWS, kbPrincipal, domain.GrantRoleAdmin, uint64(1)).
		Return(&domain.WorkspaceGrant{WorkspaceID: kbWS, PrincipalID: kbPrincipal, Role: domain.GrantRoleAdmin}, nil)
	repo.On("UpsertSpaceGrant", mock.Anything, kbWS, kbSpace, kbPrincipal, domain.GrantRoleViewer).
		Return(&domain.SpaceGrant{WorkspaceID: kbWS, SpaceID: kbSpace, PrincipalID: kbPrincipal, Role: domain.GrantRoleViewer}, nil)

	wsGrant, err := kb.NewGrantWorkspaceRoleUseCase(repo).Execute(context.Background(),
		kb.GrantWorkspaceRoleInput{WorkspaceID: kbWS, PrincipalID: kbPrincipal, Role: domain.GrantRoleAdmin, ActorUserID: 1})
	require.NoError(t, err)
	assert.Equal(t, domain.GrantRoleAdmin, wsGrant.Role)

	spGrant, err := kb.NewGrantSpaceRoleUseCase(repo).Execute(context.Background(),
		kb.GrantSpaceRoleInput{WorkspaceID: kbWS, SpaceID: kbSpace, PrincipalID: kbPrincipal, Role: domain.GrantRoleViewer})
	require.NoError(t, err)
	assert.Equal(t, domain.GrantRoleViewer, spGrant.Role)
}

func Test_権限剥奪_必須項目の検証(t *testing.T) {
	ctx := context.Background()
	repo := &mockKBPermissionRepo{}

	wsUC := kb.NewRevokeWorkspaceRoleUseCase(repo)
	require.Error(t, wsUC.Execute(ctx, kb.RevokeWorkspaceRoleInput{PrincipalID: kbPrincipal}))
	require.Error(t, wsUC.Execute(ctx, kb.RevokeWorkspaceRoleInput{WorkspaceID: kbWS}))

	spUC := kb.NewRevokeSpaceRoleUseCase(repo)
	require.Error(t, spUC.Execute(ctx, kb.RevokeSpaceRoleInput{SpaceID: kbSpace, PrincipalID: kbPrincipal}))
	require.Error(t, spUC.Execute(ctx, kb.RevokeSpaceRoleInput{WorkspaceID: kbWS, PrincipalID: kbPrincipal}))
	require.Error(t, spUC.Execute(ctx, kb.RevokeSpaceRoleInput{WorkspaceID: kbWS, SpaceID: kbSpace}))
}

func Test_権限剥奪_repository_へ委譲する(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("DeleteWorkspaceGrant", mock.Anything, kbWS, kbPrincipal, uint64(1)).Return(nil)
	repo.On("DeleteSpaceGrant", mock.Anything, kbWS, kbSpace, kbPrincipal).Return(nil)
	ctx := context.Background()

	require.NoError(t, kb.NewRevokeWorkspaceRoleUseCase(repo).Execute(ctx,
		kb.RevokeWorkspaceRoleInput{WorkspaceID: kbWS, PrincipalID: kbPrincipal, ActorUserID: 1}))
	require.NoError(t, kb.NewRevokeSpaceRoleUseCase(repo).Execute(ctx,
		kb.RevokeSpaceRoleInput{WorkspaceID: kbWS, SpaceID: kbSpace, PrincipalID: kbPrincipal}))
}

// strPtr は ParentID のようなポインタ項目をテストから書くための小道具。
func strPtr(v string) *string { return &v }

func Test_題名検索_見えないページを落とし件数を切る(t *testing.T) {
	visible := domain.Page{ID: "p-1", Title: "Docker 手順"}
	visible2 := domain.Page{ID: "p-2", Title: "Docker 入門"}
	hidden := domain.Page{ID: "p-3", Title: "Docker 機密"}

	repo := &mockKBPermissionRepo{}
	repo.On("SearchWorkspacePageViewFacts", mock.Anything, "ws-1", uint64(7), "docker").
		Return([]repository.PageSearchViewFact{
			{PageWithViewFacts: repository.PageWithViewFacts{Page: visible, Role: kbGrantRole(domain.GrantRoleViewer)}},
			// 検索はワークスペース全体を候補にするので、自分が入っていない private スペースの
			// ページも行として返る。役割が届いていないその行が、一覧と同じ判定
			// （ResolvePageView）で落ちること。
			{PageWithViewFacts: repository.PageWithViewFacts{Page: hidden, Role: nil}},
			{PageWithViewFacts: repository.PageWithViewFacts{Page: visible2, Role: kbGrantRole(domain.GrantRoleViewer)}},
		}, nil)

	uc := kb.NewSearchViewablePagesUseCase(repo)

	t.Run("役割が届いていない行は返らない", func(t *testing.T) {
		pages, err := uc.Execute(context.Background(), kb.SearchViewablePagesInput{
			WorkspaceID: "ws-1", UserID: 7, Query: "docker",
		})
		require.NoError(t, err)
		require.Len(t, pages, 2)
		assert.Equal(t, "p-1", pages[0].Page.ID)
		assert.Equal(t, "p-2", pages[1].Page.ID)
	})

	t.Run("Limit は可視でふるった後に効き、範囲外は既定・上限へ畳まれる", func(t *testing.T) {
		// 入力 → 期待件数の表。可視は 2 件しか無いので、2 以上はすべて 2 になる。
		cases := []struct {
			name  string
			limit int
			want  int
		}{
			{name: "1 なら 1 件", limit: 1, want: 2 - 1},
			{name: "0 は既定 20 → 可視の全件", limit: 0, want: 2},
			{name: "負も既定 20 → 可視の全件", limit: -5, want: 2},
			{name: "上限 50 を超えても 50 に畳まれる（可視の全件）", limit: 999, want: 2},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				pages, err := uc.Execute(context.Background(), kb.SearchViewablePagesInput{
					WorkspaceID: "ws-1", UserID: 7, Query: "docker", Limit: tc.limit,
				})
				require.NoError(t, err)
				require.Len(t, pages, tc.want)
				assert.Equal(t, "p-1", pages[0].Page.ID, "並びは repo の返した順（題名順）を保つ")
			})
		}
	})
}

func Test_題名検索_空の問い合わせは誤り(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	uc := kb.NewSearchViewablePagesUseCase(repo)
	_, err := uc.Execute(context.Background(), kb.SearchViewablePagesInput{
		WorkspaceID: "ws-1", UserID: 7, Query: "   ",
	})
	// 空で全件を返す口にしない（見えるページの全数が数えられる口になる）。
	assert.Error(t, err)
	repo.AssertNotCalled(t, "SearchWorkspacePageViewFacts", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ権限付与_必須項目と役割の検証(t *testing.T) {
	ctx := context.Background()
	uc := kb.NewGrantPageRoleUseCase(&mockKBPermissionRepo{})

	_, err := uc.Execute(ctx, kb.GrantPageRoleInput{
		PageID: kbPage, PrincipalID: kbPrincipal, Role: domain.GrantRoleEditor,
	})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.GrantPageRoleInput{
		WorkspaceID: kbWS, PrincipalID: kbPrincipal, Role: domain.GrantRoleEditor,
	})
	require.Error(t, err, "pageID 必須")
	_, err = uc.Execute(ctx, kb.GrantPageRoleInput{
		WorkspaceID: kbWS, PageID: kbPage, Role: domain.GrantRoleEditor,
	})
	require.Error(t, err, "principalID 必須")
	_, err = uc.Execute(ctx, kb.GrantPageRoleInput{
		WorkspaceID: kbWS, PageID: kbPage, PrincipalID: kbPrincipal, Role: domain.GrantRole("owner"),
	})
	require.ErrorIs(t, err, kb.ErrInvalidGrantRole)
}

func Test_ページ権限付与_別ワークスペースの主体は拒否(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindPrincipal", mock.Anything, kbWS, kbPrincipal).Return(nil, repository.ErrPrincipalNotFound)

	_, err := kb.NewGrantPageRoleUseCase(repo).Execute(context.Background(), kb.GrantPageRoleInput{
		WorkspaceID: kbWS, PageID: kbPage, PrincipalID: kbPrincipal, Role: domain.GrantRoleEditor,
	})
	require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
	// 主体を確かめる前に書き込まないこと（FK 違反ではなく not found として返すため）。
	repo.AssertNotCalled(t, "UpsertPageGrant",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ権限付与_repository_へ委譲する(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindPrincipal", mock.Anything, kbWS, kbPrincipal).
		Return(&domain.Principal{ID: kbPrincipal, WorkspaceID: kbWS, Kind: domain.PrincipalKindUser}, nil)
	repo.On("UpsertPageGrant", mock.Anything, kbWS, kbPage, kbPrincipal, domain.GrantRoleAdmin).
		Return(&domain.PageGrant{
			WorkspaceID: kbWS, PageID: kbPage, PrincipalID: kbPrincipal, Role: domain.GrantRoleAdmin,
		}, nil)

	got, err := kb.NewGrantPageRoleUseCase(repo).Execute(context.Background(), kb.GrantPageRoleInput{
		WorkspaceID: kbWS, PageID: kbPage, PrincipalID: kbPrincipal, Role: domain.GrantRoleAdmin,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.GrantRoleAdmin, got.Role)
	assert.Equal(t, kbPage, got.PageID)
}

func Test_ページ権限剥奪_必須項目の検証と委譲(t *testing.T) {
	ctx := context.Background()
	repo := &mockKBPermissionRepo{}
	uc := kb.NewRevokePageRoleUseCase(repo)

	require.Error(t, uc.Execute(ctx, kb.RevokePageRoleInput{PageID: kbPage, PrincipalID: kbPrincipal}))
	require.Error(t, uc.Execute(ctx, kb.RevokePageRoleInput{WorkspaceID: kbWS, PrincipalID: kbPrincipal}))
	require.Error(t, uc.Execute(ctx, kb.RevokePageRoleInput{WorkspaceID: kbWS, PageID: kbPage}))

	repo.On("DeletePageGrant", mock.Anything, kbWS, kbPage, kbPrincipal).Return(nil)
	require.NoError(t, uc.Execute(ctx, kb.RevokePageRoleInput{
		WorkspaceID: kbWS, PageID: kbPage, PrincipalID: kbPrincipal,
	}))
	// 実際に消しに行ったことまで見る。これが無いと、何もせず nil を返す実装でも通る。
	repo.AssertExpectations(t)
}

func Test_ページ権限一覧_必須項目の検証と委譲(t *testing.T) {
	ctx := context.Background()
	repo := &mockKBPermissionRepo{}
	uc := kb.NewListPageGrantsUseCase(repo)

	_, err := uc.Execute(ctx, kb.ListPageGrantsInput{PageID: kbPage})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.ListPageGrantsInput{WorkspaceID: kbWS})
	require.Error(t, err, "pageID 必須")

	repo.On("ListPageGrants", mock.Anything, kbWS, kbPage).
		Return([]domain.PageGrant{{WorkspaceID: kbWS, PageID: kbPage, PrincipalID: kbPrincipal}}, nil)
	got, err := uc.Execute(ctx, kb.ListPageGrantsInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, kbPrincipal, got[0].PrincipalID)
}

const (
	kbAdminA = "0198a000-0000-7000-8000-0000000000a1"
	kbAdminB = "0198a000-0000-7000-8000-0000000000a2"
	kbGroupA = "0198a000-0000-7000-8000-0000000000a3"
)

func kbUserPrincipal(id string, userID uint64) *domain.Principal {
	return &domain.Principal{
		ID: id, WorkspaceID: kbWS, Kind: domain.PrincipalKindUser, UserID: &userID,
	}
}

func kbAdminGrant(principalID string) domain.WorkspaceGrant {
	return domain.WorkspaceGrant{WorkspaceID: kbWS, PrincipalID: principalID, Role: domain.GrantRoleAdmin}
}

func Test_最後のadmin判定_必須項目の検証(t *testing.T) {
	uc := kb.NewCanRemoveWorkspaceAdminUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.CanRemoveWorkspaceAdminInput{PrincipalID: kbAdminA})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.CanRemoveWorkspaceAdminInput{WorkspaceID: kbWS})
	require.Error(t, err, "対象（principalID か userID）が必須")
}

func Test_最後のadmin判定_他にユーザーのadminが居れば外せる(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("ListWorkspaceGrants", mock.Anything, kbWS).
		Return([]domain.WorkspaceGrant{kbAdminGrant(kbAdminA), kbAdminGrant(kbAdminB)}, nil)
	repo.On("FindPrincipal", mock.Anything, kbWS, kbAdminB).Return(kbUserPrincipal(kbAdminB, 2), nil)
	uc := kb.NewCanRemoveWorkspaceAdminUseCase(repo)

	ok, err := uc.Execute(context.Background(), kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: kbWS, PrincipalID: kbAdminA,
	})
	require.NoError(t, err)
	assert.True(t, ok)
}

func Test_最後のadmin判定_ひとりだけなら外せない(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("ListWorkspaceGrants", mock.Anything, kbWS).
		Return([]domain.WorkspaceGrant{
			kbAdminGrant(kbAdminA),
			{WorkspaceID: kbWS, PrincipalID: kbAdminB, Role: domain.GrantRoleEditor},
		}, nil)
	uc := kb.NewCanRemoveWorkspaceAdminUseCase(repo)

	ok, err := uc.Execute(context.Background(), kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: kbWS, PrincipalID: kbAdminA,
	})
	require.NoError(t, err)
	assert.False(t, ok, "admin が 0 人になる操作は断る")
}

func Test_最後のadmin判定_グループ宛てのadminは数えない(t *testing.T) {
	// メンバーが 1 人も居ないグループが「最後の admin」として残ると、結局誰も
	// 権限を変えられなくなる。grant の行からは中身が分からないので数に入れない。
	repo := &mockKBPermissionRepo{}
	repo.On("ListWorkspaceGrants", mock.Anything, kbWS).
		Return([]domain.WorkspaceGrant{kbAdminGrant(kbAdminA), kbAdminGrant(kbGroupA)}, nil)
	repo.On("FindPrincipal", mock.Anything, kbWS, kbGroupA).
		Return(&domain.Principal{ID: kbGroupA, WorkspaceID: kbWS, Kind: domain.PrincipalKindGroup, Name: "運用"}, nil)
	uc := kb.NewCanRemoveWorkspaceAdminUseCase(repo)

	ok, err := uc.Execute(context.Background(), kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: kbWS, PrincipalID: kbAdminA,
	})
	require.NoError(t, err)
	assert.False(t, ok)
}

func Test_最後のadmin判定_元からadminでなければ通す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("ListWorkspaceGrants", mock.Anything, kbWS).
		Return([]domain.WorkspaceGrant{
			{WorkspaceID: kbWS, PrincipalID: kbAdminA, Role: domain.GrantRoleViewer},
		}, nil)
	uc := kb.NewCanRemoveWorkspaceAdminUseCase(repo)

	ok, err := uc.Execute(context.Background(), kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: kbWS, PrincipalID: kbAdminA,
	})
	require.NoError(t, err)
	assert.True(t, ok, "admin を 1 人も減らさない操作は止めない")
}

func Test_最後のadmin判定_ユーザーIDで指しても同じ結論になる(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindUserPrincipal", mock.Anything, kbWS, uint64(1)).Return(kbUserPrincipal(kbAdminA, 1), nil)
	repo.On("ListWorkspaceGrants", mock.Anything, kbWS).
		Return([]domain.WorkspaceGrant{kbAdminGrant(kbAdminA)}, nil)
	uc := kb.NewCanRemoveWorkspaceAdminUseCase(repo)

	ok, err := uc.Execute(context.Background(), kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: kbWS, UserID: 1,
	})
	require.NoError(t, err)
	assert.False(t, ok, "メンバー削除でも principal ごと消えて admin が 0 人になる")
}

func Test_最後のadmin判定_非メンバーは通す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("FindUserPrincipal", mock.Anything, kbWS, uint64(9)).
		Return(nil, repository.ErrPrincipalNotFound)
	uc := kb.NewCanRemoveWorkspaceAdminUseCase(repo)

	ok, err := uc.Execute(context.Background(), kb.CanRemoveWorkspaceAdminInput{
		WorkspaceID: kbWS, UserID: 9,
	})
	require.NoError(t, err)
	assert.True(t, ok)
}

func Test_スペース権限確認_必須項目の検証(t *testing.T) {
	uc := kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.CheckSpacePermissionInput{SpaceID: kbSpace, UserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.CheckSpacePermissionInput{WorkspaceID: kbWS, UserID: 1})
	assert.ErrorIs(t, err, repository.ErrSpaceNotFound, "spaceID が空なら「無い」と同じ扱い")
	_, err = uc.Execute(ctx, kb.CheckSpacePermissionInput{WorkspaceID: kbWS, SpaceID: kbSpace})
	require.Error(t, err, "userID 必須")
}

// 集めた事実（役割の集合）を畳むのは domain.ResolveScopePermission であって、
// usecase は規則を持たない。強い方が採られることを usecase 経由で確かめる。
func Test_スペース権限確認_集めた役割を規則にかけて返す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("SpacePermissionFactsForUser", mock.Anything, kbWS, kbSpace, uint64(1)).
		Return(&domain.ScopeFacts{Roles: []domain.GrantRole{
			domain.GrantRoleViewer, domain.GrantRoleEditor,
		}}, nil)
	uc := kb.NewCheckSpacePermissionUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.CheckSpacePermissionInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1,
	})
	require.NoError(t, err)
	assert.True(t, got.CanView)
	assert.True(t, got.CanEdit, "viewer と editor なら強い editor が効く")
	assert.False(t, got.CanManage)
}

func Test_スペース権限確認_役割が1つも無ければ何もできない(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("SpacePermissionFactsForUser", mock.Anything, kbWS, kbSpace, uint64(1)).
		Return(&domain.ScopeFacts{}, nil)
	uc := kb.NewCheckSpacePermissionUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.CheckSpacePermissionInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.ScopePermission{}, *got, "fail-closed（見えないものは作れない）")
}

func Test_スペース権限確認_スペースが無ければそのまま伝える(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("SpacePermissionFactsForUser", mock.Anything, kbWS, kbSpace, uint64(1)).
		Return(nil, repository.ErrSpaceNotFound)
	uc := kb.NewCheckSpacePermissionUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.CheckSpacePermissionInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, UserID: 1,
	})
	assert.ErrorIs(t, err, repository.ErrSpaceNotFound)
}

func Test_ワークスペース権限確認_必須項目の検証(t *testing.T) {
	uc := kb.NewCheckWorkspacePermissionUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.CheckWorkspacePermissionInput{UserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.CheckWorkspacePermissionInput{WorkspaceID: kbWS})
	require.Error(t, err, "userID 必須")
}

func Test_ワークスペース権限確認_集めた役割を規則にかけて返す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("WorkspacePermissionFactsForUser", mock.Anything, kbWS, uint64(1)).
		Return(&domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleAdmin}}, nil)
	uc := kb.NewCheckWorkspacePermissionUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: kbWS, UserID: 1,
	})
	require.NoError(t, err)
	assert.True(t, got.CanManage)
}

func Test_所属ワークスペース一覧_必須項目の検証(t *testing.T) {
	uc := kb.NewListMemberWorkspacesUseCase(&mockKBPermissionRepo{})

	_, err := uc.Execute(context.Background(), kb.ListMemberWorkspacesInput{})
	require.Error(t, err, "userID 必須")
}

func Test_所属ワークスペース一覧_役割の事実を規則にかけて返す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	repo.On("ListMemberWorkspaces", mock.Anything, uint64(7)).
		Return([]repository.WorkspaceWithScopeFacts{
			{
				Workspace: domain.Workspace{ID: kbWS, Slug: "acme"},
				Facts:     domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleViewer, domain.GrantRoleAdmin}},
			},
			{
				Workspace: domain.Workspace{ID: "ws-editor", Slug: "beta"},
				Facts:     domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleEditor}},
			},
			{
				Workspace: domain.Workspace{ID: "ws-none", Slug: "gamma"},
				Facts:     domain.ScopeFacts{Roles: []domain.GrantRole{}},
			},
		}, nil)
	uc := kb.NewListMemberWorkspacesUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.ListMemberWorkspacesInput{UserID: 7})
	require.NoError(t, err)
	require.Len(t, got, 3)
	assert.Equal(t, []string{"acme", "beta", "gamma"}, []string{got[0].Slug, got[1].Slug, got[2].Slug}, "並びは repository のまま")
	// 役割が複数届いていれば最も強いもの（admin）で解く。
	assert.True(t, got[0].Permission.CanManage)
	assert.True(t, got[0].Permission.CanEdit)
	assert.False(t, got[1].Permission.CanManage, "editor は管理できない")
	assert.True(t, got[1].Permission.CanEdit, "editor はチケットを作れる")
	assert.Equal(t, domain.ScopePermission{}, got[2].Permission, "役割が無ければ何もできない")
}

func Test_所属ワークスペース一覧_失敗はそのまま伝える(t *testing.T) {
	wantErr := errors.New("db down")
	repo := &mockKBPermissionRepo{}
	repo.On("ListMemberWorkspaces", mock.Anything, uint64(7)).
		Return([]repository.WorkspaceWithScopeFacts(nil), wantErr)
	uc := kb.NewListMemberWorkspacesUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.ListMemberWorkspacesInput{UserID: 7})
	assert.ErrorIs(t, err, wantErr)
}

func Test_チケットへのページ逆参照_必須項目の検証(t *testing.T) {
	uc := kb.NewListPagesReferencingTicketUseCase(&mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.ListPagesReferencingTicketInput{UserID: 1, TicketID: "t1"})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.ListPagesReferencingTicketInput{WorkspaceID: kbWS, TicketID: "t1"})
	require.Error(t, err, "userID 必須")
	_, err = uc.Execute(ctx, kb.ListPagesReferencingTicketInput{WorkspaceID: kbWS, UserID: 1})
	require.Error(t, err, "ticketID 必須")
}

// ListPageBacklinksUseCase（ページ⇔ページ）と同じ判定: 閲覧の役割が届いていない参照元は
// 行ごと出さない（存在も題名も伏せる）。
func Test_チケットへのページ逆参照_閲覧できる参照元だけを返す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	visible := "00000000-0000-7000-8000-000000000011"
	unreachable := "00000000-0000-7000-8000-000000000012"
	repo.On("ListPageTicketLinkSourcePageViewFacts", mock.Anything, kbWS, uint64(7), "ticket-1").
		Return([]repository.PageWithViewFacts{
			kbViewableFacts(visible, "埋め込み元ページ"),
			kbUnreachableFacts(unreachable, "届かないページ"),
		}, nil)

	uc := kb.NewListPagesReferencingTicketUseCase(repo)
	got, err := uc.Execute(context.Background(), kb.ListPagesReferencingTicketInput{
		WorkspaceID: kbWS, UserID: 7, TicketID: "ticket-1",
	})
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, visible, got[0].ID)
}

func Test_ワークスペースの人の一覧_repositoryの結果をそのまま返す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	want := []domain.WorkspaceMember{{PrincipalID: kbPrincipal, UserID: 42, Name: "田中 太郎"}}
	repo.On("ListWorkspaceMembers", mock.Anything, kbWS).Return(want, nil)

	got, err := kb.NewListWorkspaceMembersUseCase(repo).Execute(context.Background(), kbWS)

	require.NoError(t, err)
	assert.Equal(t, want, got)
}

func Test_ワークスペースの人の一覧_ワークスペースIDが無ければ拒む(t *testing.T) {
	repo := &mockKBPermissionRepo{}

	_, err := kb.NewListWorkspaceMembersUseCase(repo).Execute(context.Background(), "")

	require.Error(t, err)
	repo.AssertNotCalled(t, "ListWorkspaceMembers")
}
