package domain_test

import (
	"fmt"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func role(r domain.GrantRole) *domain.GrantRole { return &r }

// rank は届いた役割の強さ。届いていなければ 0（何もできない）。
func rank(r *domain.GrantRole) int {
	if r == nil {
		return 0
	}
	return r.Rank()
}

func Test_実効権限_届いた役割どおりに決まる(t *testing.T) {
	cases := []struct {
		name    string
		facts   domain.PagePermissionFacts
		canView bool
		canEdit bool
	}{
		{name: "付与が無ければ何もできない", facts: domain.PagePermissionFacts{Member: true}},
		{
			name:    "viewer は閲覧のみ",
			facts:   domain.PagePermissionFacts{Member: true, Role: role(domain.GrantRoleViewer)},
			canView: true,
		},
		{
			name:    "commenter は閲覧のみ（編集は不可）",
			facts:   domain.PagePermissionFacts{Member: true, Role: role(domain.GrantRoleCommenter)},
			canView: true,
		},
		{
			name:    "editor は閲覧と編集",
			facts:   domain.PagePermissionFacts{Member: true, Role: role(domain.GrantRoleEditor)},
			canView: true, canEdit: true,
		},
		{
			name:    "admin は閲覧と編集",
			facts:   domain.PagePermissionFacts{Member: true, Role: role(domain.GrantRoleAdmin)},
			canView: true, canEdit: true,
		},
		{
			name:  "未知の役割は届いていないのと同じ",
			facts: domain.PagePermissionFacts{Member: true, Role: role(domain.GrantRole("owner"))},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := domain.ResolvePagePermission(tc.facts)
			assert.Equal(t, tc.canView, got.CanView, "閲覧")
			assert.Equal(t, tc.canEdit, got.CanEdit, "編集")
		})
	}
}

// 編集できるなら必ず閲覧もできる。閲覧できないページを編集できる状態は UI でも監査でも
// 説明できない。
//
// **この不変条件は、いまの入力では破りようがない。** 役割の並び（GrantRole.Rank）では
// editor 以上が必ず viewer 以上になる。だから
// ResolvePagePermission の `canView &&` を外しても答えは変わらず、**このテストは
// その掛け合わせを守っていない**（変異が生き残ることを確認済み）。守れるのは
// 「編集できる入力では閲覧もできる」という結果の側だけで、それをここで固定する。
//
// 掛け合わせ自体は、役割の種類を増やしたときに崩れないための保険として
// 実装に残してある（そのとき初めてこのテストが破れる側に回る）。
func Test_実効権限_編集できるなら閲覧もできる(t *testing.T) {
	roles := append([]domain.GrantRole{}, domain.ValidGrantRoles...)
	roles = append(roles, domain.GrantRole("owner"))
	for _, r := range roles {
		t.Run(string(r), func(t *testing.T) {
			got := domain.ResolvePagePermission(domain.PagePermissionFacts{Member: true, Role: role(r)})
			if got.CanEdit {
				assert.True(t, got.CanView, "編集できるのに閲覧できない役割がある")
			}
		})
	}
}

// 所属していない相手には役割が 1 つも届かない（役割は principals の kind='user' の行から
// 集めるので、その行が無ければ集めようがない）。事実がこの形になることは
// 所属していない相手は、役割が届いていても何もできない。
//
// **これは規則の側で閉じていることを見るテスト。** 本番では事実を集める側（SQL）が
// 主体を辿るので、所属していなければ役割はそもそも届かない — つまり
// {Member: false, Role: editor} は本番では作れない事実。それをあえて渡すのは、
// 集め方を変えたときに規則が開かないことを固定するため。
func Test_実効権限_所属していなければ役割が届いていても何もできない(t *testing.T) {
	for _, r := range []domain.GrantRole{
		domain.GrantRoleAdmin, domain.GrantRoleEditor,
		domain.GrantRoleCommenter, domain.GrantRoleViewer,
	} {
		t.Run(string(r), func(t *testing.T) {
			got := domain.ResolvePagePermission(domain.PagePermissionFacts{Member: false, Role: role(r)})
			assert.False(t, got.CanView, "所属していないのに閲覧できる")
			assert.False(t, got.CanEdit, "所属していないのに編集できる")
			assert.False(t, got.CanComment, "所属していないのにコメントできる")
		})
	}

	// 同じ役割でも、所属していれば届く（上の false が「役割の側の問題」ではないことを見る）。
	member := domain.ResolvePagePermission(
		domain.PagePermissionFacts{Member: true, Role: role(domain.GrantRoleAdmin)},
	)
	assert.True(t, member.CanEdit, "所属していれば admin は編集できる")
}

// 一覧（役割の列しか集めない経路）と 1 ページ解決が食い違わないことを、
// 届きうる役割の全種類で固定する。片方だけ直すと「開けるのに一覧に出ない」ずれになる。
func Test_実効権限_一覧の閲覧判定は1ページ解決とつねに一致する(t *testing.T) {
	roles := []*domain.GrantRole{
		nil,
		role(domain.GrantRoleViewer),
		role(domain.GrantRoleCommenter),
		role(domain.GrantRoleEditor),
		role(domain.GrantRoleAdmin),
		role(domain.GrantRole("owner")),
	}
	for _, r := range roles {
		want := domain.ResolvePagePermission(domain.PagePermissionFacts{Member: true, Role: r}).CanView
		assert.Equal(t, want, domain.ResolvePageView(r, domain.PageVisibilitySpace, false), "役割 %v", r)
	}
}

// visibility='private' は、作成者以外には役割がどれだけ強くても一切見せない
// （grants の「打ち消す層は持たない」原則の唯一の例外。段 13）。
// 一覧（ResolvePageView）と 1 ページ解決（ResolvePagePermission）の両方で固定する
// — 片方だけ直すと「開けるのに一覧には出ない／一覧に出るのに開けない」というずれになる。
func Test_ページ権限_visibilityがprivateなら作成者以外には一切見せない(t *testing.T) {
	roles := []*domain.GrantRole{
		nil,
		role(domain.GrantRoleViewer),
		role(domain.GrantRoleCommenter),
		role(domain.GrantRoleEditor),
		role(domain.GrantRoleAdmin),
	}
	for _, r := range roles {
		t.Run(fmt.Sprintf("role=%v", r), func(t *testing.T) {
			// 作成者本人でなければ、admin 相当の役割が届いていても何も許さない。
			got := domain.ResolvePagePermission(domain.PagePermissionFacts{
				Member: true, Role: r, Visibility: domain.PageVisibilityPrivate, IsOwner: false,
			})
			assert.False(t, got.CanView, "作成者以外なのに閲覧できる")
			assert.False(t, got.CanEdit, "作成者以外なのに編集できる")
			assert.False(t, got.CanComment, "作成者以外なのにコメントできる")
			assert.False(t, domain.ResolvePageView(r, domain.PageVisibilityPrivate, false),
				"一覧側でも作成者以外なのに閲覧できる")

			// 作成者本人には、届いている役割どおりに見える（private であること自体は
			// 本人の閲覧を妨げない）。
			ownerGot := domain.ResolvePagePermission(domain.PagePermissionFacts{
				Member: true, Role: r, Visibility: domain.PageVisibilityPrivate, IsOwner: true,
			})
			want := domain.ResolvePagePermission(domain.PagePermissionFacts{
				Member: true, Role: r, Visibility: domain.PageVisibilitySpace, IsOwner: true,
			})
			assert.Equal(t, want, ownerGot, "作成者本人には private であること自体は影響しないはず")
			assert.Equal(t, want.CanView, domain.ResolvePageView(r, domain.PageVisibilityPrivate, true))
		})
	}

	// 'public' / 'space' / ゼロ値は、閲覧可否に何の影響も与えない（表示上の区別でしかない）。
	t.Run("private以外は閲覧可否を一切変えない", func(t *testing.T) {
		for _, v := range []domain.PageVisibility{
			domain.PageVisibilityPublic, domain.PageVisibilitySpace, domain.PageVisibility(""),
		} {
			base := domain.ResolvePagePermission(domain.PagePermissionFacts{
				Member: true, Role: role(domain.GrantRoleViewer),
			})
			got := domain.ResolvePagePermission(domain.PagePermissionFacts{
				Member: true, Role: role(domain.GrantRoleViewer), Visibility: v, IsOwner: false,
			})
			assert.Equal(t, base, got, "visibility=%q が閲覧可否を変えてしまっている", v)
		}
	})
}

// 付与を足しても役割は弱くならない、という合成規則の性質を固定する。
//
// **これは domain の合成（StrongestGrantRole）についての主張で、本番のページ経路の
// 証明ではない。** ページ 1 枚 / 一覧の役割は SQL 側が max で畳んだ強さを persistence が
// `GrantRoleByRank` で戻して作るので、この関数を通らない。SQL 側が同じ性質を持つことは
// 結合テスト（ワークスペースとスペースの 2 段を合わせる経路）が確かめる。
//
// ここで固定するのは「規則の側は単調である」こと。SQL とこの規則の両方が単調でなければ、
// 「ワークスペースで編集できるのに、スペースの付与を足したら編集できなくなる」が起きないとは言えない。
func Test_役割_付与を足しても弱くならない(t *testing.T) {
	pool := []domain.GrantRole{
		domain.GrantRoleAdmin,
		domain.GrantRoleEditor,
		domain.GrantRoleCommenter,
		domain.GrantRoleViewer,
		domain.GrantRole("owner"), // 未知の値。数えないが、足しても弱くしてはいけない
	}
	for mask := 0; mask < 1<<len(pool); mask++ {
		ancestor := make([]domain.GrantRole, 0, len(pool))
		for i, r := range pool {
			if mask&(1<<i) != 0 {
				ancestor = append(ancestor, r)
			}
		}
		ancestorRole := domain.StrongestGrantRole(ancestor)
		ancestorPerm := domain.ResolvePagePermission(
			domain.PagePermissionFacts{Member: true, Role: ancestorRole},
		)

		for _, added := range pool {
			descendant := make([]domain.GrantRole, 0, len(ancestor)+1)
			descendant = append(descendant, ancestor...)
			descendant = append(descendant, added)

			descendantRole := domain.StrongestGrantRole(descendant)
			assert.GreaterOrEqual(t, rank(descendantRole), rank(ancestorRole),
				"%v に %s を足したら弱くなった", ancestor, added)

			got := domain.ResolvePagePermission(
				domain.PagePermissionFacts{Member: true, Role: descendantRole},
			)
			if ancestorPerm.CanView {
				assert.True(t, got.CanView, "%v で閲覧できたのに足したら閲覧できない", ancestor)
			}
			if ancestorPerm.CanEdit {
				assert.True(t, got.CanEdit, "%v で編集できたのに足したら編集できない", ancestor)
			}
		}
	}
}

func Test_実効権限_Allows(t *testing.T) {
	p := domain.PagePermission{CanView: true, CanEdit: false}
	assert.True(t, p.Allows(domain.CapabilityView))
	assert.False(t, p.Allows(domain.CapabilityEdit))
	assert.True(t, p.Allows(domain.Capability("unknown")), "既知でない値は閲覧として扱う（最も弱い解釈）")
}

func Test_役割_強さと権限(t *testing.T) {
	assert.Greater(t, domain.GrantRoleAdmin.Rank(), domain.GrantRoleEditor.Rank())
	assert.Greater(t, domain.GrantRoleEditor.Rank(), domain.GrantRoleCommenter.Rank())
	assert.Greater(t, domain.GrantRoleCommenter.Rank(), domain.GrantRoleViewer.Rank())
	assert.Equal(t, 0, domain.GrantRole("unknown").Rank())

	assert.True(t, domain.GrantRoleAdmin.CanManage())
	assert.False(t, domain.GrantRoleEditor.CanManage())
	assert.True(t, domain.GrantRoleCommenter.CanComment())
	assert.False(t, domain.GrantRoleViewer.CanComment())
	assert.False(t, domain.GrantRole("unknown").CanView())
}

func Test_役割_強さからの逆引き(t *testing.T) {
	for _, r := range domain.ValidGrantRoles {
		got := domain.GrantRoleByRank(r.Rank())
		require.NotNil(t, got, "%s の逆引き", r)
		assert.Equal(t, r, *got)
	}
	assert.Nil(t, domain.GrantRoleByRank(0), "0 は付与なし")
	assert.Nil(t, domain.GrantRoleByRank(99))
}

func Test_権限モデルの値の検証(t *testing.T) {
	for _, k := range domain.ValidPrincipalKinds {
		assert.True(t, k.Valid(), string(k))
	}
	assert.False(t, domain.PrincipalKind("robot").Valid())

	for _, r := range domain.ValidGrantRoles {
		assert.True(t, r.Valid(), string(r))
	}
	assert.False(t, domain.GrantRole("owner").Valid())

	for _, v := range []domain.PageVisibility{
		domain.PageVisibilityPublic, domain.PageVisibilitySpace, domain.PageVisibilityPrivate,
	} {
		assert.True(t, domain.ValidPageVisibility(v), string(v))
	}
	assert.False(t, domain.ValidPageVisibility(domain.PageVisibility("unknown")))
	assert.False(t, domain.ValidPageVisibility(domain.PageVisibility("")))
}

// コメントできるかは commenter 以上の役割で決まる
// （役割は必ず閲覧も含むので canView との掛け合わせは結果を変えないが、canEdit と同じ
// 防御的な書き方を踏襲している）。
func Test_ページ権限_コメントできるか(t *testing.T) {
	cases := []struct {
		name string
		role *domain.GrantRole
		want bool
	}{
		{name: "commenter はコメントできる", role: role(domain.GrantRoleCommenter), want: true},
		{name: "editor はコメントできる", role: role(domain.GrantRoleEditor), want: true},
		{name: "admin はコメントできる", role: role(domain.GrantRoleAdmin), want: true},
		{name: "viewer はコメントできない", role: role(domain.GrantRoleViewer), want: false},
		{name: "役割が無ければコメントできない", role: nil, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := domain.ResolvePagePermission(domain.PagePermissionFacts{Member: true, Role: tc.role})
			assert.Equal(t, tc.want, got.CanComment)
		})
	}
}
