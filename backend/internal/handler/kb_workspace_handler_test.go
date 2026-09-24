package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ワークスペース / スペースの API は判定対象がページではないので、kbEndpoints の表
// （ページ 1 枚の権限を軸に回す）とは別にここで検証する。

func Test_ナレッジAPI_ワークスペース削除(t *testing.T) {
	t.Run("admin は配下ごと消せる", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodDelete, "/api/v2/kb/workspaces/"+kbWorkspaceSlug, "")

		require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
		// 配下も消える（本番は FK の CASCADE・fake も同じ結果に揃えてある）。
		assert.Nil(t, f.pages.spaces[kbSpaceID])
		assert.Nil(t, f.pages.pages[kbChildPageID])
	})

	t.Run("admin でなければ 403（実在は既に知っている相手なので理由を返す）", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleEditor)

		w := f.do(t, http.MethodDelete, "/api/v2/kb/workspaces/"+kbWorkspaceSlug, "")

		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.JSONEq(t, `{"error":"forbidden"}`, w.Body.String())
		assert.NotNil(t, f.pages.spaces[kbSpaceID], "拒否したのに消えてはいけない")
	})

	t.Run("人が所属しているワークスペースは admin でも消せない", func(t *testing.T) {
		// そこに全員のナレッジが入るので、1 人の操作でみんなの資産が消えてよいはずがない。
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)
		workspacesWithMembers[kbWorkspaceID] = true
		t.Cleanup(func() { delete(workspacesWithMembers, kbWorkspaceID) })

		w := f.do(t, http.MethodDelete, "/api/v2/kb/workspaces/"+kbWorkspaceSlug, "")

		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.JSONEq(t, `{"error":"workspace_has_members"}`, w.Body.String())
		assert.NotNil(t, f.pages.spaces[kbSpaceID], "人が所属しているワークスペースの中身が消えてはいけない")
	})

	t.Run("別のワークスペースの slug では 404（所属していないため）", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodDelete, "/api/v2/kb/workspaces/"+kbOtherWorkspaceSlug, "")

		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("repository の失敗は 500", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)
		f.pages.failWith = errors.New("db down")

		w := f.do(t, http.MethodDelete, "/api/v2/kb/workspaces/"+kbWorkspaceSlug, "")

		assert.Equal(t, http.StatusInternalServerError, w.Code)
	})
}

func Test_ナレッジAPI_所属ワークスペース一覧は所属しているものだけを返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodGet, kbWorkspacesPath, "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got []kbWorkspaceResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	require.Len(t, got, 1, "所属しているのは 1 つだけ")
	assert.Equal(t, kbWorkspaceSlug, got[0].Slug)
	assert.NotContains(t, w.Body.String(), kbOtherWorkspaceSlug,
		"所属していないワークスペースは 1 件も漏らさない")
	assert.NotContains(t, w.Body.String(), kbWorkspaceID, "内部 UUID は返さない")
}

func Test_ナレッジAPI_所属ワークスペース一覧は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w := f.do(t, http.MethodGet, kbWorkspacesPath, "")

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func Test_ナレッジAPI_所属ワークスペース一覧は0件でも空配列(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// 所属を消す（principals の行が唯一の表現なので、消せば非メンバー）。
	f.perms.principals = map[string]*domain.Principal{}

	w := f.do(t, http.MethodGet, kbWorkspacesPath, "")

	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `[]`, w.Body.String(), "null ではなく空配列")
}

func Test_ナレッジAPI_ワークスペース作成は作成者をメンバーにする(t *testing.T) {
	const otherUser = uint64(777)
	f := newKbFixture(kbCanEdit, otherUser)

	w := f.do(t, http.MethodPost, kbWorkspacesPath, `{"slug":"new-team","name":"新チーム"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	var created kbWorkspaceResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	assert.Equal(t, "new-team", created.Slug)
	assert.True(t, created.CanManage, "作成者は admin")
	assert.True(t, created.CanCreateTickets, "admin はチケットも作れる")

	// 作成者が自分の作ったワークスペースに入れること。ここが崩れると
	// middleware が所属を確かめて 404 にするため、誰も入れないワークスペースが残る。
	listed := f.do(t, http.MethodGet, kbWorkspacesPath, "")
	require.Equal(t, http.StatusOK, listed.Code)
	assert.Contains(t, listed.Body.String(), "new-team", "作成者は所属一覧に出る")

	ws, err := f.pages.FindWorkspaceBySlug(t.Context(), "new-team")
	require.NoError(t, err)
	member, err := f.perms.IsWorkspaceMember(t.Context(), ws.ID, otherUser)
	require.NoError(t, err)
	assert.True(t, member, "作成者は principal を持つ（＝ メンバー）")

	facts, err := f.perms.WorkspacePermissionFactsForUser(t.Context(), ws.ID, otherUser)
	require.NoError(t, err)
	assert.True(t, domain.ResolveScopePermission(*facts).CanManage,
		"作成者は admin なので自分のワークスペースを設定できる")
}

func Test_ナレッジAPI_ワークスペース作成はslugの重複を409で断る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodPost, kbWorkspacesPath,
		`{"slug":"`+kbOtherWorkspaceSlug+`","name":"横取り"}`)

	assert.Equal(t, http.StatusConflict, w.Code, w.Body.String())
	assert.JSONEq(t, `{"error":"slug_taken"}`, w.Body.String())
}

func Test_ナレッジAPI_ワークスペース作成は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w := f.do(t, http.MethodPost, kbWorkspacesPath, `{"slug":"new-team","name":"新チーム"}`)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func Test_ナレッジAPI_ワークスペース作成は連打をレート制限で断る(t *testing.T) {
	// slug はテナントをまたいで一意で、取られた slug を取り返す口が無い。
	// 上限が無いと 1 人で短い slug を掴み取れてしまうので、作成だけは流量を絞る。
	f := newKbFixture(kbCanEdit, kbUserID)

	for i := range 5 {
		slug := "team-" + strconv.Itoa(i)
		w := f.do(t, http.MethodPost, kbWorkspacesPath, `{"slug":"`+slug+`","name":"新チーム"}`)
		require.Equal(t, http.StatusCreated, w.Code, "burst の範囲内: %s", w.Body.String())
	}

	over := f.do(t, http.MethodPost, kbWorkspacesPath, `{"slug":"team-over","name":"新チーム"}`)

	assert.Equal(t, http.StatusTooManyRequests, over.Code, over.Body.String())
	assert.Equal(t, "60", over.Header().Get("Retry-After"), "再試行の目安を返す")
	_, err := f.pages.FindWorkspaceBySlug(t.Context(), "team-over")
	assert.ErrorIs(t, err, repository.ErrWorkspaceNotFound, "断った要求は slug を取らない")

	// 一覧は絞らない（読みは掴み取りに使えないため）。
	assert.Equal(t, http.StatusOK, f.do(t, http.MethodGet, kbWorkspacesPath, "").Code)
}

// fake が本番より緩いと、本番では通らない作成要求で緑になるテストが書けてしまう。
// 実 PostgreSQL 側の対応する検証は knowledge_base_provision_integration_test.go にある。
func Test_ナレッジテスト用fake_存在しないワークスペースへのスペース作成を拒む(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	err := f.pages.CreateSpace(t.Context(), &domain.Space{
		WorkspaceID: "workspace-missing", Key: "eng", Name: "開発部",
	})

	assert.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
}

func Test_ナレッジAPI_ワークスペース作成の失敗は500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.provisioner.failWith = errors.New("db down")

	w := f.do(t, http.MethodPost, kbWorkspacesPath, `{"slug":"new-team","name":"新チーム"}`)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

// スペース作成は「ワークスペース単位」の判定で、admin だけが通る。
func Test_ナレッジAPI_スペース作成はワークスペースのadminだけが通る(t *testing.T) {
	spacesPath := kbFill(kbSpacesPath, kbWorkspaceSlug, "")

	t.Run("admin なら作れる", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"開発部"}`)

		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
		var got kbSpaceResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "eng", got.Key)
		assert.NotEmpty(t, got.ID, "以降の URL で使うのでスペース ID は返す")
	})

	t.Run("editor では作れない", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleEditor)

		w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"開発部"}`)

		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"forbidden"}`, w.Body.String())
	})

	t.Run("役割が無ければ作れない", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)

		w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"開発部"}`)

		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	})

	t.Run("スペースのadminではワークスペースの操作は通らない", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		// あるスペースの admin であっても、ワークスペース単位の判定には効かない。
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"開発部"}`)

		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	})

	t.Run("別ワークスペースのslugは404", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodPost, kbFill(kbSpacesPath, kbOtherWorkspaceSlug, ""),
			`{"key":"eng","name":"開発部"}`)

		assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	})

	t.Run("未認証は401", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, 0)

		w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"開発部"}`)

		assert.Equal(t, http.StatusUnauthorized, w.Code)
	})
}

func Test_ナレッジAPI_スペース作成はkeyの重複を409で断る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)
	spacesPath := kbFill(kbSpacesPath, kbWorkspaceSlug, "")

	require.Equal(t, http.StatusCreated,
		f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"開発部"}`).Code)
	w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"別の部署"}`)

	assert.Equal(t, http.StatusConflict, w.Code, w.Body.String())
	assert.JSONEq(t, `{"error":"space_key_taken"}`, w.Body.String())
}

func Test_ナレッジAPI_スペース作成は不正なkeyと長すぎる名前を400で断る(t *testing.T) {
	spacesPath := kbFill(kbSpacesPath, kbWorkspaceSlug, "")
	cases := []struct {
		name string
		body string
	}{
		{name: "key に大文字や記号", body: `{"key":"ENG!","name":"開発部"}`},
		{name: "key の先頭がハイフン", body: `{"key":"-eng","name":"開発部"}`},
		{name: "name が 201 文字", body: `{"key":"eng","name":"` + strings.Repeat("あ", 201) + `"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

			w := f.do(t, http.MethodPost, spacesPath, tc.body)

			assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
		})
	}
}

// スペース直下へのページ作成（parentId 省略）は「スペースの編集権限」で判断する。
func Test_ナレッジAPI_スペース直下のページ作成はスペースの権限で判断する(t *testing.T) {
	pagesPath := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/spaces/" + kbSpaceID + "/pages"

	t.Run("スペースのeditorならルートページを作れる", func(t *testing.T) {
		f := newKbFixture(kbNoPerm, kbUserID) // ページ単位の既定は「何もできない」
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleEditor)

		w := f.do(t, http.MethodPost, pagesPath, `{"title":"最初のページ"}`)

		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
		var page kbPageResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &page))
		assert.Nil(t, page.ParentID, "スペース直下（ルート）に作る")
		assert.Equal(t, kbSpaceID, page.SpaceID)
	})

	t.Run("スペースのviewerでは作れない", func(t *testing.T) {
		f := newKbFixture(kbNoPerm, kbUserID)
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleViewer)

		w := f.do(t, http.MethodPost, pagesPath, `{"title":"最初のページ"}`)

		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"forbidden"}`, w.Body.String())
	})

	t.Run("役割が無ければスペースの実在を漏らさず404", func(t *testing.T) {
		f := newKbFixture(kbNoPerm, kbUserID)

		w := f.do(t, http.MethodPost, pagesPath, `{"title":"最初のページ"}`)

		assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
	})

	t.Run("存在しないスペースは404", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)
		missing := "/api/v2/kb/workspaces/" + kbWorkspaceSlug +
			"/spaces/0198a000-0000-7000-8000-00000000dead/pages"

		w := f.do(t, http.MethodPost, missing, `{"title":"最初のページ"}`)

		assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	})

	t.Run("親を指定した作成はURLのスペースの権限では通らない", func(t *testing.T) {
		// URL のスペースでは editor だが、親に指定したページは自分に役割の届かない
		// スペースにある。ここをスペース単位の判定で通してしまうと、開けもしない
		// ページの下へ書き込める経路が開く。
		//
		// 「親だけ弱い役割を張る」では再現できない。役割は 3 段（ワークスペース /
		// スペース / ページ）から届いて最も強いものが実効になり、下の段が上の段を
		// 弱めることはないため。届かない親を作るには別のスペースへ置くしかない
		// （本番の運用と同じ）。
		f := newKbFixture(kbNoPerm, kbUserID)
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleEditor)
		// 子を持つページは動かせない（スペースは親子で揃う）ので、末端の dest を親にする。
		f.perms.hideInOwnPrivateSpace(kbWorkspaceID, kbDestPageID)

		w := f.do(t, http.MethodPost, pagesPath, `{"parentId":"`+kbDestPageID+`","title":"子"}`)

		// 本文まで見る。**コードだけでは足りない。** 親が別スペースにある以上、
		// 権限の判定を素通りしても CreatePageUseCase の別スペース検査（400
		// parent_space_mismatch）で止まる。本文を見ないと、権限で断ったのか
		// 別スペースで断ったのかが区別できず、判定を緩めても緑のままになる。
		assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String(),
			"権限で断ったことを見る（別スペース検査で断ったのなら parent_space_mismatch になる）")
	})

	t.Run("別ワークスペースのslugでは作れない", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleAdmin)
		other := "/api/v2/kb/workspaces/" + kbOtherWorkspaceSlug + "/spaces/" + kbSpaceID + "/pages"

		w := f.do(t, http.MethodPost, other, `{"title":"最初のページ"}`)

		assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	})
}

// kbSecondSpaceID はスペース一覧のテストで使う 2 つ目のスペース。
// 1 つしか無いと「権限のあるものだけを返す」と「全部返す」が同じ結果になり、
// ふるいを外しても緑のままになる。
const kbSecondSpaceID = "0198a000-0000-7000-8000-0000000000a2"

// プライベートスペース: 自分の区画が増えるだけなので、admin でないメンバーでも作れる。
// チームスペース（省略時）は今までどおり admin だけ（上のテスト）。この非対称が仕様。
func Test_ナレッジAPI_プライベートスペースはメンバーなら作れる(t *testing.T) {
	spacesPath := kbFill(kbSpacesPath, kbWorkspaceSlug, "")

	t.Run("editor でも private なら作れて、応答に visibility が載る", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleEditor)

		w := f.do(t, http.MethodPost, spacesPath, `{"name":"自分のメモ","visibility":"private"}`)

		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
		var got kbSpaceResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "private", got.Visibility)
		assert.NotEmpty(t, got.Key, "key は自動採番される")

		// 作成者の一覧に出る（provisioner が作成者へ grant を張っている）。
		// ワークスペース既定（editor）は private に届かないので、
		// この grant が無ければ作った本人にも見えない。
		_, list := kbListSpaces(t, f, kbWorkspaceSlug)
		found := false
		for _, s := range list {
			if s.ID == got.ID {
				found = true
				assert.Equal(t, "private", s.Visibility, "一覧の応答にも visibility が載る（節分けの判定材料）")
			}
		}
		assert.True(t, found, "作った本人の一覧に出る")
	})

	t.Run("private では key を指定できない（409 から他人のスペースの実在を読ませない）", func(t *testing.T) {
		// key はチームとプライベートで同じ名前空間。明示指定を許すと「409 が返るか」で
		// 一覧にも出ないはずの他人のプライベートスペースの実在を言い当てられる。
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleEditor)

		w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"探り","visibility":"private"}`)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.JSONEq(t, `{"error":"invalid_request"}`, w.Body.String())
	})

	t.Run("チームスペースでは今までどおり key を指定できる（admin だけが到達する）", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodPost, spacesPath, `{"key":"eng","name":"開発部"}`)

		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	})

	t.Run("visibility が未知の値なら 400", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodPost, spacesPath, `{"name":"x","visibility":"secret"}`)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("チームスペースの応答は visibility=workspace", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

		w := f.do(t, http.MethodPost, spacesPath, `{"name":"開発部"}`)

		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
		var got kbSpaceResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "workspace", got.Visibility)
	})
}

// どのワークスペースにも所属しないユーザーの一覧は空で、失敗にしない。
//
// 段 2 より前は「会社のワークスペースへ自動で入る」導線がここにあったが、同意なく
// 他人をワークスペースへ入れられる穴と同根だったため撤去した（招待→受諾フローに一本化。
// kb_invitation_handler_test.go 参照）。
func Test_ナレッジAPI_所属先が無いユーザーの一覧は空(t *testing.T) {
	const staff = uint64(780)
	f := newKbFixture(kbCanEdit, staff)
	// 所属を設定しない（運営管理者のようにワークスペースを持たない人）。

	w := f.do(t, http.MethodGet, "/api/v2/kb/workspaces", "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.JSONEq(t, `[]`, w.Body.String())
}

// 一覧の canManage / canCreateTickets は、削除とチケット作成の入口が 1 件ずつ確かめる判定
// （ワークスペースの役割を domain で解いた CanManage / CanEdit）と同じ値になる。
func Test_ナレッジAPI_ワークスペース一覧は操作の可否を役割から添える(t *testing.T) {
	for _, tc := range []struct {
		name          string
		role          *domain.GrantRole
		canManage     bool
		canCreateTask bool
	}{
		{"admin は管理もチケット作成もできる", ptrRole(domain.GrantRoleAdmin), true, true},
		{"editor はチケットを作れるが管理はできない", ptrRole(domain.GrantRoleEditor), false, true},
		{"commenter はチケットを作れない", ptrRole(domain.GrantRoleCommenter), false, false},
		{"viewer はチケットを作れない", ptrRole(domain.GrantRoleViewer), false, false},
		{"役割の無い所属は何もできない", nil, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			if tc.role != nil {
				f.perms.setScopeRole(kbWorkspaceID, kbUserID, *tc.role)
			}

			w := f.do(t, http.MethodGet, kbWorkspacesPath, "")

			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			var got []kbWorkspaceResponse
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
			require.Len(t, got, 1)
			assert.Equal(t, kbWorkspaceSlug, got[0].Slug)
			assert.Equal(t, tc.canManage, got[0].CanManage)
			assert.Equal(t, tc.canCreateTask, got[0].CanCreateTickets)
		})
	}
}

func ptrRole(r domain.GrantRole) *domain.GrantRole { return &r }

// kbListSpaces はスペース一覧を叩いて応答をデコードする。
func kbListSpaces(t *testing.T, f kbFixture, slug string) (*httptest.ResponseRecorder, []kbSpaceResponse) {
	t.Helper()
	w := f.do(t, http.MethodGet, kbFill(kbSpacesPath, slug, ""), "")
	if w.Code != http.StatusOK {
		return w, nil
	}
	var got []kbSpaceResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	return w, got
}

func Test_ナレッジAPI_スペース一覧は閲覧できるスペースだけを返す(t *testing.T) {
	// スペースは「誰に何を見せるか」を分ける入れ物なので、key と name が並ぶだけでも
	// 中で何が進んでいるかが伝わる。役割が届いていないスペースは 1 件も出さない。
	roles := []domain.GrantRole{
		domain.GrantRoleViewer, domain.GrantRoleCommenter,
		domain.GrantRoleEditor, domain.GrantRoleAdmin,
	}
	for _, role := range roles {
		t.Run(string(role)+"はそのスペースだけ見える", func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			f.pages.addSpace(kbWorkspaceID, kbSecondSpaceID)
			// 役割はスペース単位で 1 つ目にだけ張る（2 つ目には何も届かない）。
			f.perms.setScopeRole(kbSpaceID, kbUserID, role)

			w, got := kbListSpaces(t, f, kbWorkspaceSlug)

			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			require.Len(t, got, 1, "役割が届いているスペースだけ")
			assert.Equal(t, kbSpaceID, got[0].ID)
			assert.NotContains(t, w.Body.String(), kbSecondSpaceID,
				"閲覧権限の無いスペースは ID も key も漏らさない")
		})
	}

	t.Run("役割が1つも無ければ1件も返らない", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.pages.addSpace(kbWorkspaceID, kbSecondSpaceID)

		w, got := kbListSpaces(t, f, kbWorkspaceSlug)

		require.Equal(t, http.StatusOK, w.Code)
		assert.Empty(t, got, "所属しているだけでは中身は見えない")
		assert.JSONEq(t, `[]`, w.Body.String(), "null ではなく空配列")
	})

	t.Run("ワークスペース全体の役割は配下の全スペースへ届く", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.pages.addSpace(kbWorkspaceID, kbSecondSpaceID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleViewer)

		_, got := kbListSpaces(t, f, kbWorkspaceSlug)

		require.Len(t, got, 2, "ワークスペースの grant はスペースを選ばない")
	})
}

func Test_ナレッジAPI_スペース一覧はスペースが0件でも空配列(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)
	f.pages.spaces = map[string]*domain.Space{}

	w, _ := kbListSpaces(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `[]`, w.Body.String(),
		"null を返すとフロントの .map が TypeError で落ちる")
}

func Test_ナレッジAPI_スペース一覧は存在しないワークスペースと権限の無いワークスペースを区別できない(t *testing.T) {
	// slug の総当たりで他社テナントの実在が分からないこと。判定は middleware にあり、
	// この口は「メンバーであること」を前提に動く。
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleAdmin)

	unknown, _ := kbListSpaces(t, f, "no-such-workspace")
	foreign, _ := kbListSpaces(t, f, kbOtherWorkspaceSlug)

	assert.Equal(t, http.StatusNotFound, unknown.Code)
	assert.Equal(t, unknown.Code, foreign.Code)
	assert.Equal(t, unknown.Body.String(), foreign.Body.String())
}

func Test_ナレッジAPI_スペース一覧は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w, _ := kbListSpaces(t, f, kbWorkspaceSlug)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func Test_ナレッジAPI_スペース一覧は事実の収集に失敗したら500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.scopeFactsErr = errors.New("db down")

	w, _ := kbListSpaces(t, f, kbWorkspaceSlug)

	assert.Equal(t, http.StatusInternalServerError, w.Code,
		"確かめられないなら見せない（空配列で「無い」と答えない）")
}

// kbMembersPath はワークスペースの人の一覧。担当の表示名と発言での名指しに使う。
const kbMembersPath = "/api/v2/kb/workspaces/{slug}/members"

func kbListMembers(t *testing.T, f kbFixture, slug string) (*httptest.ResponseRecorder, []kbWorkspaceMemberResponse) {
	t.Helper()
	w := f.do(t, http.MethodGet, kbFill(kbMembersPath, slug, ""), "")
	if w.Code != http.StatusOK {
		return w, nil
	}
	var got []kbWorkspaceMemberResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	return w, got
}

func Test_ナレッジAPI_人の一覧は所属していれば誰でも叩ける(t *testing.T) {
	// 権限を張る相手の一覧（/pages/:pageId/principals）はページの管理権限を要求する。
	// 既定の役割は編集者なので、そちらを名前解決に流用すると管理者以外では 403 になる。
	// こちらは役割を 1 つも持たないメンバーでも読める（所属の確認は middleware が済ませている）。
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.userNames[kbUserID] = "田中 太郎"

	w, got := kbListMembers(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, got, 1)
	assert.Equal(t, kbUserID, got[0].UserID, "名指しはユーザーを指すので userId が要る")
	assert.Equal(t, "田中 太郎", got[0].Name)
	assert.NotEmpty(t, got[0].PrincipalID, "担当は主体に割り当てるので principalId も要る")
}

func Test_ナレッジAPI_人の一覧は人でない主体を返さない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.userNames[kbUserID] = "田中 太郎"
	_, err := f.perms.CreateGroupPrincipal(context.Background(), kbWorkspaceID, "開発チーム")
	require.NoError(t, err)
	_, err = f.perms.EnsureSpaceEveryonePrincipal(context.Background(), kbWorkspaceID, kbSpaceID)
	require.NoError(t, err)

	_, got := kbListMembers(t, f, kbWorkspaceSlug)

	require.Len(t, got, 1, "グループとスペース全員は名指しの相手にも担当にもならない")
	assert.Equal(t, kbUserID, got[0].UserID)
}

func Test_ナレッジAPI_人の一覧は名前を引けない人を返さない(t *testing.T) {
	// 本番の SQL は users との内部結合なので、消えたユーザーの主体は行ごと落ちる。
	f := newKbFixture(kbCanEdit, kbUserID)

	w, got := kbListMembers(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, got)
	assert.JSONEq(t, `[]`, w.Body.String(), "null を返すとフロントの .map が落ちる")
}

func Test_ナレッジAPI_人の一覧は所属していないワークスペースでは404(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	unknown, _ := kbListMembers(t, f, "no-such-workspace")
	foreign, _ := kbListMembers(t, f, kbOtherWorkspaceSlug)

	assert.Equal(t, http.StatusNotFound, unknown.Code)
	assert.Equal(t, unknown.Body.String(), foreign.Body.String(), "実在の有無を撃ち分けない")
}

func Test_ナレッジAPI_人の一覧は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w, _ := kbListMembers(t, f, kbWorkspaceSlug)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// kbFavoritesPath はワークスペース内の自分のお気に入り一覧（段7）。
const kbFavoritesPath = "/api/v2/kb/workspaces/{slug}/favorites"

func kbListFavorites(t *testing.T, f kbFixture, slug string) (*httptest.ResponseRecorder, []kbFavoritePageResponse) {
	t.Helper()
	w := f.do(t, http.MethodGet, kbFill(kbFavoritesPath, slug, ""), "")
	if w.Code != http.StatusOK {
		return w, nil
	}
	var got []kbFavoritePageResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	return w, got
}

func Test_ナレッジAPI_お気に入り一覧は所属していれば誰でも叩ける(t *testing.T) {
	f := newKbFixture(kbCanView, kbUserID)
	f.favorites.listFor[kbWorkspaceID] = []domain.PageFavorite{
		{PageID: kbRootPageID, Title: "root", SpaceID: kbSpaceID, SpaceName: "space"},
	}

	w, got := kbListFavorites(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, got, 1)
	assert.Equal(t, kbRootPageID, got[0].PageID)
}

// hiddenPageID は実在するページ（kbDestPageID）で明示的に CanView を落としてある。存在しない
// ID だと CheckPagePermissionUseCase 自体が「page not found」で continue し、可視判定の分岐を
// 経由しないまま偶然テストが通ってしまうため、必ず実在するページを使う
// （kb_me_handler_test.go の同種の注記と同じ理由）。
//
// 変異確認: ListPageFavoritesUseCase.Execute の `if !perm.CanView { continue }` を外すと、
// 見えないはずの hiddenPageID がここに出てきてこのテストが落ちる。
func Test_ナレッジAPI_お気に入り一覧は可視判定でふるわれる(t *testing.T) {
	f := newKbFixture(kbCanView, kbUserID)
	hiddenPageID := kbDestPageID
	f.perms.setPagePermission(hiddenPageID, kbUserID, domain.PagePermission{})
	f.favorites.listFor[kbWorkspaceID] = []domain.PageFavorite{
		{PageID: kbRootPageID, Title: "root", SpaceID: kbSpaceID, SpaceName: "space"},
		{PageID: hiddenPageID, Title: "hidden", SpaceID: kbSpaceID, SpaceName: "space"},
	}

	w, got := kbListFavorites(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, got, 1)
	assert.Equal(t, kbRootPageID, got[0].PageID)
}

func Test_ナレッジAPI_お気に入り一覧は所属していないワークスペースでは404(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	unknown, _ := kbListFavorites(t, f, "no-such-workspace")
	foreign, _ := kbListFavorites(t, f, kbOtherWorkspaceSlug)

	assert.Equal(t, http.StatusNotFound, unknown.Code)
	assert.Equal(t, unknown.Body.String(), foreign.Body.String(), "実在の有無を撃ち分けない")
}

func Test_ナレッジAPI_お気に入り一覧は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w, _ := kbListFavorites(t, f, kbWorkspaceSlug)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func kbListSpaceMembers(t *testing.T, f kbFixture, slug, spaceID string) (*httptest.ResponseRecorder, []kbSpaceMemberResponse) {
	t.Helper()
	path := "/api/v2/kb/workspaces/" + slug + "/spaces/" + spaceID + "/members"
	w := f.do(t, http.MethodGet, path, "")
	if w.Code != http.StatusOK {
		return w, nil
	}
	var got []kbSpaceMemberResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	return w, got
}

// スペースメンバーの読み取り（段9）は判定がスペース単位の CanView。RenameSpace（管理）とは
// 軸を分けているので、拒否の畳み方（見えない=404・見えるが役割の話は無い）も別に確かめる。
func Test_ナレッジAPI_スペースメンバーは閲覧できれば誰でも読める(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleViewer)
	f.perms.userNames[kbUserID] = "田中 太郎"

	w, got := kbListSpaceMembers(t, f, kbWorkspaceSlug, kbSpaceID)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, got, 1)
	assert.Equal(t, kbUserID, got[0].UserID)
	assert.Equal(t, domain.GrantRoleViewer, got[0].Role)
	assert.Equal(t, "direct", got[0].Via)
}

// 変異確認: knowledgeBasePermissionRepository.ListSpaceMembers の Rank 比較（role.Rank() >
// cur.role.Rank()）を「常に採用しない」向きに壊すと、複数経路のうち弱い方が残ってこのテストが
// 落ちる（ここでは fake 側の集約ロジックを固定するテスト。本物の集約は結合テストで確認する）。
func Test_ナレッジAPI_スペースメンバーは複数経路のうち最も強い役割を返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// ワークスペース全体では viewer、スペース直接では admin。強い方（admin・direct）が残ること。
	f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleViewer)
	f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleAdmin)
	f.perms.userNames[kbUserID] = "鈴木 花子"

	_, got := kbListSpaceMembers(t, f, kbWorkspaceSlug, kbSpaceID)

	require.Len(t, got, 1)
	assert.Equal(t, domain.GrantRoleAdmin, got[0].Role)
	assert.Equal(t, "direct", got[0].Via)
}

func Test_ナレッジAPI_スペースメンバーは役割の無い相手には実在するスペースも存在しないIDも同じ404(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	real, _ := kbListSpaceMembers(t, f, kbWorkspaceSlug, kbSpaceID)
	missing, _ := kbListSpaceMembers(t, f, kbWorkspaceSlug, "00000000-0000-7000-8000-00000000dead")
	require.Equal(t, http.StatusNotFound, real.Code)
	require.Equal(t, http.StatusNotFound, missing.Code)
	assert.Equal(t, missing.Body.String(), real.Body.String())
}

func Test_ナレッジAPI_スペースメンバーは未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)
	w, _ := kbListSpaceMembers(t, f, kbWorkspaceSlug, kbSpaceID)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// kbMySpacesPath は自分がアクセスできるスペースの一覧（段14）。ListSpaceMembers の向きを
// 逆にしたもの（1 スペース→全員 ではなく 1 人→全スペース）。
const kbMySpacesPath = "/api/v2/kb/workspaces/{slug}/me/spaces"

func kbListMySpaces(t *testing.T, f kbFixture, slug string) (*httptest.ResponseRecorder, []kbMySpaceResponse) {
	t.Helper()
	w := f.do(t, http.MethodGet, kbFill(kbMySpacesPath, slug, ""), "")
	if w.Code != http.StatusOK {
		return w, nil
	}
	var got []kbMySpaceResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	return w, got
}

// 自分のスペース一覧（段14）は判定がワークスペース所属のみ（ListMembers と同じ軸）。
// 中身のふるいは grants の集約そのものなので、ListSpaceMembers と対になる観点で確かめる。
func Test_ナレッジAPI_自分のスペース一覧は直接付与された役割を返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleViewer)

	w, got := kbListMySpaces(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, got, 1)
	assert.Equal(t, kbSpaceID, got[0].ID)
	assert.Equal(t, domain.GrantRoleViewer, got[0].Role)
}

func Test_ナレッジAPI_自分のスペース一覧は役割の無いスペースを含まない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// scopeRole を何も張らない = ワークスペースにもスペースにも役割が無い。

	w, got := kbListMySpaces(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Empty(t, got)
	assert.JSONEq(t, `[]`, w.Body.String(), "null を返すとフロントの .map が落ちる")
}

func Test_ナレッジAPI_自分のスペース一覧は直接付与がワークスペース全体からの継承より優先する(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// ワークスペース全体では viewer、スペース直接では admin。強い方（admin）が残ること。
	f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleViewer)
	f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleAdmin)

	w, got := kbListMySpaces(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, got, 1)
	assert.Equal(t, domain.GrantRoleAdmin, got[0].Role)
}

// 変異確認: knowledgeBasePermissionRepository.ListMySpaces の visibility 判定
// （sp.Visibility != domain.SpaceVisibilityPrivate）を外すと、private スペースにも
// ワークスペース全体の役割が継承されてしまい、このテストが落ちる。
func Test_ナレッジAPI_自分のスペース一覧はprivateスペースにワークスペース全体の役割を継承しない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleEditor)
	f.pages.spaces[kbSpaceID].Visibility = domain.SpaceVisibilityPrivate

	w, got := kbListMySpaces(t, f, kbWorkspaceSlug)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Empty(t, got)
}

func Test_ナレッジAPI_自分のスペース一覧は所属していないワークスペースでは404(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	unknown, _ := kbListMySpaces(t, f, "no-such-workspace")
	foreign, _ := kbListMySpaces(t, f, kbOtherWorkspaceSlug)

	assert.Equal(t, http.StatusNotFound, unknown.Code)
	assert.Equal(t, unknown.Body.String(), foreign.Body.String(), "実在の有無を撃ち分けない")
}

func Test_ナレッジAPI_自分のスペース一覧は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w, _ := kbListMySpaces(t, f, kbWorkspaceSlug)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// kbMembershipEventsPath は所属・権限の変更履歴（段 6・監査）。admin だけが読める。
const kbMembershipEventsPath = "/api/v2/kb/workspaces/{slug}/membership-events"

func Test_ナレッジAPI_変更履歴はadmin以外には403(t *testing.T) {
	// CanManage を持たない役割（editor）では読めない。存在の有無で応答を変えない
	// ほかの権限操作 API とは違い、ここは所属していることは既に確定している
	// （middleware.KnowledgeBaseWorkspace を通っている）ので 403 でよい。
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodGet, kbFill(kbMembershipEventsPath, kbWorkspaceSlug, ""), "")

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func Test_ナレッジAPI_変更履歴はadminなら読める(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	caller, err := f.perms.EnsureUserPrincipal(context.Background(), kbWorkspaceID, kbUserID)
	require.NoError(t, err)
	_, err = f.perms.UpsertWorkspaceGrant(context.Background(), kbWorkspaceID, caller.ID, domain.GrantRoleAdmin, kbUserID)
	require.NoError(t, err)

	w := f.do(t, http.MethodGet, kbFill(kbMembershipEventsPath, kbWorkspaceSlug, ""), "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got []kbMembershipEventResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	assert.NotNil(t, got, "0 件でも null ではなく [] を返す")
}

func Test_ナレッジAPI_変更履歴は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w := f.do(t, http.MethodGet, kbFill(kbMembershipEventsPath, kbWorkspaceSlug, ""), "")

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

// kbAdminMembersPath はメンバー管理画面（段 7）向けの一覧。admin だけが読める。
const kbAdminMembersPath = "/api/v2/kb/workspaces/{slug}/admin/members"

func Test_ナレッジAPI_管理者向け一覧はadmin以外には403(t *testing.T) {
	// ListMembers（誰でも読める）と違い、こちらは役割変更・停止・削除の対象を選ぶ
	// 画面そのものなので admin 限定。変更履歴と同じ CanManage の判定（存在は既に
	// 確定しているので 404 ではなく 403）。
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodGet, kbFill(kbAdminMembersPath, kbWorkspaceSlug, ""), "")

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func Test_ナレッジAPI_管理者向け一覧はadminなら役割つきで読める(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.userNames[kbUserID] = "田中 太郎"
	caller, err := f.perms.EnsureUserPrincipal(context.Background(), kbWorkspaceID, kbUserID)
	require.NoError(t, err)
	_, err = f.perms.UpsertWorkspaceGrant(context.Background(), kbWorkspaceID, caller.ID, domain.GrantRoleAdmin, kbUserID)
	require.NoError(t, err)

	w := f.do(t, http.MethodGet, kbFill(kbAdminMembersPath, kbWorkspaceSlug, ""), "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got []kbAdminWorkspaceMemberResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	require.Len(t, got, 1)
	assert.Equal(t, kbUserID, got[0].UserID)
	assert.Equal(t, "田中 太郎", got[0].Name)
	require.NotNil(t, got[0].Role, "ワークスペース全体の役割を持つ相手には role が付く")
	assert.Equal(t, "admin", *got[0].Role)
	assert.Equal(t, "active", got[0].AccountStatus)
}

func Test_ナレッジAPI_管理者向け一覧は役割の無いメンバーもroleなしで返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.userNames[kbUserID] = "admin本人"
	caller, err := f.perms.EnsureUserPrincipal(context.Background(), kbWorkspaceID, kbUserID)
	require.NoError(t, err)
	_, err = f.perms.UpsertWorkspaceGrant(context.Background(), kbWorkspaceID, caller.ID, domain.GrantRoleAdmin, kbUserID)
	require.NoError(t, err)

	// ワークスペース全体の grant を持たないメンバー（スペース/ページ単位の grant だけで
	// 見えている想定）。
	f.perms.userNames[kbSecondUserID] = "役割なしメンバー"
	_, err = f.perms.EnsureUserPrincipal(context.Background(), kbWorkspaceID, kbSecondUserID)
	require.NoError(t, err)

	w := f.do(t, http.MethodGet, kbFill(kbAdminMembersPath, kbWorkspaceSlug, ""), "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got []kbAdminWorkspaceMemberResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	require.Len(t, got, 2)
	byUserID := map[uint64]kbAdminWorkspaceMemberResponse{}
	for _, m := range got {
		byUserID[m.UserID] = m
	}
	require.Nil(t, byUserID[kbSecondUserID].Role, "role を持たない相手は role フィールドごと省く")
}

func Test_ナレッジAPI_管理者向け一覧は未認証なら401(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)

	w := f.do(t, http.MethodGet, kbFill(kbAdminMembersPath, kbWorkspaceSlug, ""), "")

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
