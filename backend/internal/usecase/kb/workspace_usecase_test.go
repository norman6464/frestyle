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

const kbSlug = "acme"

func Test_ワークスペース解決_所属していれば返る(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	perm := &mockKBPermissionRepo{}
	repo.On("FindWorkspaceBySlug", mock.Anything, kbSlug).
		Return(&domain.Workspace{ID: kbWS, Slug: kbSlug, IsActive: true}, nil)
	perm.On("IsWorkspaceMember", mock.Anything, kbWS, uint64(1)).Return(true, nil)
	uc := kb.NewResolveWorkspaceUseCase(repo, perm)

	ws, err := uc.Execute(context.Background(), kb.ResolveWorkspaceInput{Slug: kbSlug, UserID: 1})

	require.NoError(t, err)
	assert.Equal(t, kbWS, ws.ID)
}

func Test_ワークスペース解決_停止中なら存在しないのと同じ(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	perm := &mockKBPermissionRepo{}
	repo.On("FindWorkspaceBySlug", mock.Anything, kbSlug).
		Return(&domain.Workspace{ID: kbWS, Slug: kbSlug, IsActive: false}, nil)
	uc := kb.NewResolveWorkspaceUseCase(repo, perm)

	_, err := uc.Execute(context.Background(), kb.ResolveWorkspaceInput{Slug: kbSlug, UserID: 1})

	// 停止中は所属の有無を調べるより先に断つ。調べてしまうと、停止したはずの
	// ワークスペースへ principals の行が足されうる。
	assert.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
	perm.AssertNotCalled(t, "IsWorkspaceMember", mock.Anything, mock.Anything, mock.Anything)
}

func Test_ワークスペース解決_未所属は存在しないのと同じ(t *testing.T) {
	member := &mockKnowledgeBaseRepo{}
	memberPerm := &mockKBPermissionRepo{}
	member.On("FindWorkspaceBySlug", mock.Anything, kbSlug).
		Return(&domain.Workspace{ID: kbWS, Slug: kbSlug, IsActive: true}, nil)
	// 段 2 以降、URL を知っているだけでは入れない（招待→受諾を経ていない非メンバーは
	// 404 のまま）。
	memberPerm.On("IsWorkspaceMember", mock.Anything, kbWS, uint64(1)).Return(false, nil)

	unknown := &mockKnowledgeBaseRepo{}
	unknown.On("FindWorkspaceBySlug", mock.Anything, "no-such").
		Return(nil, repository.ErrWorkspaceNotFound)

	_, foreignErr := kb.NewResolveWorkspaceUseCase(member, memberPerm).
		Execute(context.Background(), kb.ResolveWorkspaceInput{Slug: kbSlug, UserID: 1})
	_, unknownErr := kb.NewResolveWorkspaceUseCase(unknown, &mockKBPermissionRepo{}).
		Execute(context.Background(), kb.ResolveWorkspaceInput{Slug: "no-such", UserID: 1})

	require.ErrorIs(t, foreignErr, repository.ErrWorkspaceNotFound,
		"未所属と不在を撃ち分けない（slug の総当たりでテナントの実在を漏らさない）")
	require.ErrorIs(t, unknownErr, repository.ErrWorkspaceNotFound)
}

func Test_ワークスペース解決_入力の検証(t *testing.T) {
	uc := kb.NewResolveWorkspaceUseCase(&mockKnowledgeBaseRepo{}, &mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.ResolveWorkspaceInput{Slug: kbSlug})
	require.Error(t, err, "userID 必須")

	_, err = uc.Execute(ctx, kb.ResolveWorkspaceInput{UserID: 1})
	require.ErrorIs(t, err, repository.ErrWorkspaceNotFound, "空 slug は不在扱い")
}

func Test_ワークスペース解決_所属判定の失敗はそのまま返す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	perm := &mockKBPermissionRepo{}
	boom := errors.New("db down")
	repo.On("FindWorkspaceBySlug", mock.Anything, kbSlug).
		Return(&domain.Workspace{ID: kbWS, Slug: kbSlug, IsActive: true}, nil)
	perm.On("IsWorkspaceMember", mock.Anything, kbWS, uint64(1)).Return(false, boom)
	uc := kb.NewResolveWorkspaceUseCase(repo, perm)

	_, err := uc.Execute(context.Background(), kb.ResolveWorkspaceInput{Slug: kbSlug, UserID: 1})

	require.ErrorIs(t, err, boom, "DB 障害を「不在」に潰すと 500 が 404 に化ける")
}

// mockWorkspaceProvisioner は repository.WorkspaceProvisioner のモック。
type mockWorkspaceProvisioner struct{ mock.Mock }

var _ repository.WorkspaceProvisioner = (*mockWorkspaceProvisioner)(nil)

func (m *mockWorkspaceProvisioner) ProvisionWorkspace(
	ctx context.Context, in repository.WorkspaceProvisionInput,
) (*domain.Workspace, error) {
	args := m.Called(ctx, in)
	ws, _ := args.Get(0).(*domain.Workspace)
	return ws, args.Error(1)
}

func (m *mockWorkspaceProvisioner) ProvisionPrivateSpace(
	ctx context.Context, in repository.PrivateSpaceProvisionInput,
) (*domain.Space, error) {
	args := m.Called(ctx, in)
	sp, _ := args.Get(0).(*domain.Space)
	return sp, args.Error(1)
}

func Test_ワークスペース作成_入力の検証(t *testing.T) {
	// 弾かれた入力が provisioner まで届かないこと（届くと DB の CHECK 頼みになり 500 になる）。
	provisioner := &mockWorkspaceProvisioner{}
	uc := kb.NewCreateWorkspaceUseCase(provisioner)
	ctx := context.Background()

	cases := []struct {
		name string
		in   kb.CreateWorkspaceInput
	}{
		{name: "作成者が無い", in: kb.CreateWorkspaceInput{Slug: "acme", Name: "Acme"}},
		{name: "slug に大文字", in: kb.CreateWorkspaceInput{Slug: "Acme", Name: "Acme", OwnerUserID: 1}},
		{name: "slug に記号", in: kb.CreateWorkspaceInput{Slug: "acme inc", Name: "Acme", OwnerUserID: 1}},
		{name: "slug の先頭がハイフン", in: kb.CreateWorkspaceInput{Slug: "-acme", Name: "Acme", OwnerUserID: 1}},
		{name: "slug の末尾がハイフン", in: kb.CreateWorkspaceInput{Slug: "acme-", Name: "Acme", OwnerUserID: 1}},
		{
			name: "slug が列幅を超える",
			in: kb.CreateWorkspaceInput{
				Slug: strings.Repeat("a", domain.WorkspaceSlugMaxLen+1), Name: "Acme", OwnerUserID: 1,
			},
		},
		{name: "名前が空", in: kb.CreateWorkspaceInput{Slug: "acme", OwnerUserID: 1}},
		{
			name: "名前が列幅を超える",
			in: kb.CreateWorkspaceInput{
				Slug: "acme", Name: strings.Repeat("あ", domain.WorkspaceNameMaxLen+1), OwnerUserID: 1,
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := uc.Execute(ctx, tc.in)
			require.Error(t, err)
		})
	}
	provisioner.AssertNotCalled(t, "ProvisionWorkspace", mock.Anything, mock.Anything)
}

func Test_ワークスペース作成_名前は文字数で数える(t *testing.T) {
	provisioner := &mockWorkspaceProvisioner{}
	name := strings.Repeat("あ", domain.WorkspaceNameMaxLen)
	provisioner.On("ProvisionWorkspace", mock.Anything, repository.WorkspaceProvisionInput{
		Slug: "acme", Name: name, OwnerUserID: 1,
	}).Return(&domain.Workspace{ID: kbWS, Slug: "acme", Name: name}, nil)
	uc := kb.NewCreateWorkspaceUseCase(provisioner)

	// varchar(200) は「文字数」の上限なので、バイト数で数えると日本語 200 文字を弾いてしまう。
	got, err := uc.Execute(context.Background(), kb.CreateWorkspaceInput{
		Slug: "acme", Name: name, OwnerUserID: 1,
	})
	require.NoError(t, err)
	assert.Equal(t, "acme", got.Slug)
}

func Test_ワークスペース作成_作成者をそのまま渡す(t *testing.T) {
	// 作成者を admin のメンバーにするのは provisioner（1 トランザクション）の責務なので、
	// usecase の責任は「誰が作ったかを取り違えずに渡すこと」に尽きる。
	provisioner := &mockWorkspaceProvisioner{}
	provisioner.On("ProvisionWorkspace", mock.Anything, repository.WorkspaceProvisionInput{
		Slug: "new-team", Name: "新チーム", OwnerUserID: 42,
	}).Return(&domain.Workspace{ID: kbWS, Slug: "new-team", Name: "新チーム"}, nil)
	uc := kb.NewCreateWorkspaceUseCase(provisioner)

	got, err := uc.Execute(context.Background(), kb.CreateWorkspaceInput{
		Slug: "new-team", Name: "新チーム", OwnerUserID: 42,
	})
	require.NoError(t, err)
	assert.Equal(t, "new-team", got.Slug)
	provisioner.AssertExpectations(t)
}

func Test_ワークスペース作成_slug衝突はそのまま伝える(t *testing.T) {
	provisioner := &mockWorkspaceProvisioner{}
	provisioner.On("ProvisionWorkspace", mock.Anything, mock.Anything).
		Return(nil, repository.ErrWorkspaceSlugTaken)
	uc := kb.NewCreateWorkspaceUseCase(provisioner)

	_, err := uc.Execute(context.Background(), kb.CreateWorkspaceInput{
		Slug: "acme", Name: "Acme", OwnerUserID: 1,
	})
	assert.ErrorIs(t, err, repository.ErrWorkspaceSlugTaken)
}

func Test_スペース作成_入力の検証(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	uc := kb.NewCreateSpaceUseCase(repo, &mockWorkspaceProvisioner{})
	ctx := context.Background()

	cases := []struct {
		name string
		in   kb.CreateSpaceInput
	}{
		{name: "workspaceID が無い", in: kb.CreateSpaceInput{Key: "eng", Name: "開発部"}},
		{name: "key に大文字", in: kb.CreateSpaceInput{WorkspaceID: kbWS, Key: "ENG", Name: "開発部"}},
		{
			name: "key が列幅を超える",
			in: kb.CreateSpaceInput{
				WorkspaceID: kbWS, Key: strings.Repeat("a", domain.SpaceKeyMaxLen+1), Name: "開発部",
			},
		},
		{name: "名前が空", in: kb.CreateSpaceInput{WorkspaceID: kbWS, Key: "eng"}},
		{
			name: "名前が列幅を超える",
			in: kb.CreateSpaceInput{
				WorkspaceID: kbWS, Key: "eng", Name: strings.Repeat("あ", domain.SpaceNameMaxLen+1),
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := uc.Execute(ctx, tc.in)
			require.Error(t, err)
		})
	}
	repo.AssertNotCalled(t, "CreateSpace", mock.Anything, mock.Anything)
}

func Test_スペース作成_repositoryが確定させた行を返す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("CreateSpace", mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
		space := args.Get(1).(*domain.Space)
		space.ID = kbSpace // ID の採番は repository の責務。
	}).Return(nil)
	uc := kb.NewCreateSpaceUseCase(repo, &mockWorkspaceProvisioner{})

	got, err := uc.Execute(context.Background(), kb.CreateSpaceInput{
		WorkspaceID: kbWS, Key: "eng", Name: "開発部",
	})
	require.NoError(t, err)
	assert.Equal(t, kbSpace, got.ID)
	assert.Equal(t, kbWS, got.WorkspaceID)
	assert.Equal(t, "eng", got.Key)
}

func Test_スペース作成_key衝突はそのまま伝える(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("CreateSpace", mock.Anything, mock.Anything).Return(repository.ErrSpaceKeyTaken)
	uc := kb.NewCreateSpaceUseCase(repo, &mockWorkspaceProvisioner{})

	_, err := uc.Execute(context.Background(), kb.CreateSpaceInput{
		WorkspaceID: kbWS, Key: "eng", Name: "開発部",
	})
	assert.ErrorIs(t, err, repository.ErrSpaceKeyTaken)
}

func Test_スペース改名_検証と伝播(t *testing.T) {
	t.Run("空の名前と文字数超過は repo に届く前に弾く", func(t *testing.T) {
		repo := &mockKnowledgeBaseRepo{}
		uc := kb.NewRenameSpaceUseCase(repo)
		for _, name := range []string{"", strings.Repeat("あ", 201)} {
			_, err := uc.Execute(context.Background(), kb.RenameSpaceInput{
				WorkspaceID: "ws-1", SpaceID: "sp-1", Name: name,
			})
			assert.ErrorIs(t, err, kb.ErrInvalidName)
		}
		repo.AssertNotCalled(t, "UpdateSpaceName", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("200 文字ちょうどは通る（列幅は文字数）", func(t *testing.T) {
		repo := &mockKnowledgeBaseRepo{}
		name := strings.Repeat("あ", 200)
		repo.On("UpdateSpaceName", mock.Anything, "ws-1", "sp-1", name).Return(nil)
		repo.On("FindSpace", mock.Anything, "ws-1", "sp-1").
			Return(&domain.Space{ID: "sp-1", WorkspaceID: "ws-1", Key: "eng", Name: name}, nil)
		uc := kb.NewRenameSpaceUseCase(repo)
		got, err := uc.Execute(context.Background(), kb.RenameSpaceInput{
			WorkspaceID: "ws-1", SpaceID: "sp-1", Name: name,
		})
		require.NoError(t, err)
		assert.Equal(t, name, got.Name)
		// UpdateSpaceName を呼ばずに FindSpace の結果だけ返す回帰を捕まえる。
		repo.AssertExpectations(t)
	})

	t.Run("存在しないスペースは ErrSpaceNotFound をそのまま伝える", func(t *testing.T) {
		repo := &mockKnowledgeBaseRepo{}
		repo.On("UpdateSpaceName", mock.Anything, "ws-1", "sp-x", "新名").
			Return(repository.ErrSpaceNotFound)
		uc := kb.NewRenameSpaceUseCase(repo)
		_, err := uc.Execute(context.Background(), kb.RenameSpaceInput{
			WorkspaceID: "ws-1", SpaceID: "sp-x", Name: "新名",
		})
		assert.ErrorIs(t, err, repository.ErrSpaceNotFound)
		repo.AssertExpectations(t)
	})
}

func Test_ワークスペース作成_slugが空なら自動採番される(t *testing.T) {
	// URL に使う名前は利用者に決めさせない（ユーザー決定 2026-08-28）。
	// 空で渡すと形の正しい slug が生成され、そのまま provisioner に届くこと。
	provisioner := &mockWorkspaceProvisioner{}
	var got repository.WorkspaceProvisionInput
	provisioner.On("ProvisionWorkspace", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { got, _ = args.Get(1).(repository.WorkspaceProvisionInput) }).
		Return(&domain.Workspace{ID: "ws-1", Slug: "w-abc", Name: "Acme"}, nil)
	uc := kb.NewCreateWorkspaceUseCase(provisioner)

	_, err := uc.Execute(context.Background(), kb.CreateWorkspaceInput{Name: "Acme", OwnerUserID: 1})
	require.NoError(t, err)
	assert.True(t, domain.ValidWorkspaceSlug(got.Slug), "生成された slug %q が URL の規則を満たすこと", got.Slug)
	assert.True(t, strings.HasPrefix(got.Slug, "w-"))
}

func Test_スペース作成_keyが空なら自動採番される(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	var got *domain.Space
	repo.On("CreateSpace", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { got, _ = args.Get(1).(*domain.Space) }).
		Return(nil)
	uc := kb.NewCreateSpaceUseCase(repo, &mockWorkspaceProvisioner{})

	_, err := uc.Execute(context.Background(), kb.CreateSpaceInput{WorkspaceID: "ws-1", Name: "開発部"})
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.True(t, domain.ValidSpaceKey(got.Key), "生成された key %q が規則を満たすこと", got.Key)
	assert.True(t, strings.HasPrefix(got.Key, "s-"))
}
