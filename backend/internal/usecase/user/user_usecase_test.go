package user

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

type stubUserRepo struct {
	user *domain.User
	err  error
}

func (s *stubUserRepo) FindByOidcSubject(_ context.Context, _ string) (*domain.User, error) {
	return s.user, s.err
}

func (s *stubUserRepo) FindByID(_ context.Context, _ uint64) (*domain.User, error) {
	return s.user, s.err
}

func (s *stubUserRepo) FindDisplayByID(_ context.Context, userID uint64) (*domain.UserDisplay, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.user == nil {
		return nil, nil
	}
	return &domain.UserDisplay{UserID: userID, Name: s.user.Name}, nil
}

func (s *stubUserRepo) FindActiveIDByEmail(context.Context, string) (uint64, bool, error) {
	return 0, false, nil
}

func (s *stubUserRepo) ListByWorkspaceID(_ context.Context, _ string) ([]domain.User, error) {
	return nil, s.err
}

func (s *stubUserRepo) Create(_ context.Context, _ *domain.User) error {
	return s.err
}

func (s *stubUserRepo) UpdateName(_ context.Context, _ uint64, _ string) error {
	return s.err
}

func (s *stubUserRepo) UpdateEmail(_ context.Context, _ uint64, _ string) error {
	return s.err
}

func (s *stubUserRepo) UpdateWorkspaceID(_ context.Context, _ uint64, _ *string) error {
	return s.err
}

func (s *stubUserRepo) UpdateActive(context.Context, uint64, bool) error { return nil }
func (s *stubUserRepo) SoftDelete(context.Context, uint64) error         { return nil }

func (s *stubUserRepo) OidcSubjectByUserID(context.Context, uint64) (string, error) {
	return "", nil
}

// fakeTxManager は repository.TxManager のテスト用 no-op 実装。fn(ctx) をそのまま呼ぶだけで、
// 実 DB もトランザクションも介さない。本ファイル内の複数のテストで共有する。
type fakeTxManager struct{}

func (fakeTxManager) DoInTx(ctx context.Context, fn func(context.Context) error) error {
	return fn(ctx)
}

func Test_現在ユーザー取得_見つかる(t *testing.T) {
	want := &domain.User{ID: 1, Email: "u@example.com"}
	uc := NewGetCurrentUserUseCase(&stubUserRepo{user: want})
	got, err := uc.Execute(context.Background(), "abc")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got == nil || got.ID != 1 {
		t.Fatalf("want %+v, got %+v", want, got)
	}
}

func Test_現在ユーザー取得_見つからない(t *testing.T) {
	uc := NewGetCurrentUserUseCase(&stubUserRepo{user: nil})
	got, err := uc.Execute(context.Background(), "missing")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

func Test_現在ユーザー取得_エラー(t *testing.T) {
	uc := NewGetCurrentUserUseCase(&stubUserRepo{err: errors.New("db down")})
	if _, err := uc.Execute(context.Background(), "x"); err == nil {
		t.Fatal("expected error")
	}
}

// upsertUserRepoSpy は UpsertUserFromIDTokenUseCase の呼び出しを記録する UserRepository の spy。
type upsertUserRepoSpy struct {
	stubUserRepo
	created *domain.User

	findByOidcSubjectCalls int
	createCalls            int
	createErr              error
	nameUpdateCalls        int
	nameUpdateErr          error
	emailUpdateCalls       int
	emailUpdateErr         error
	emailUpdateUserID      uint64
	emailUpdateValue       string
}

func (s *upsertUserRepoSpy) FindByOidcSubject(
	ctx context.Context,
	sub string,
) (*domain.User, error) {
	s.findByOidcSubjectCalls++
	return s.stubUserRepo.FindByOidcSubject(ctx, sub)
}

func (s *upsertUserRepoSpy) Create(
	_ context.Context,
	user *domain.User,
) error {
	s.createCalls++
	if s.createErr != nil {
		return s.createErr
	}

	copied := *user
	s.created = &copied
	return nil
}

func (s *upsertUserRepoSpy) UpdateName(
	_ context.Context,
	_ uint64,
	_ string,
) error {
	s.nameUpdateCalls++
	return s.nameUpdateErr
}

func (s *upsertUserRepoSpy) UpdateEmail(
	_ context.Context,
	userID uint64,
	email string,
) error {
	s.emailUpdateCalls++
	s.emailUpdateUserID = userID
	s.emailUpdateValue = email
	return s.emailUpdateErr
}

// upsertOidcIdentitySpy は UpsertUserFromIDTokenUseCase の呼び出しを記録する
// UserOidcIdentityRepository の spy。
type upsertOidcIdentitySpy struct {
	ensureIdentityCalls int
	ensuredUserID       uint64
	ensuredProvider     string
	ensuredSubject      string
	err                 error
}

func (s *upsertOidcIdentitySpy) EnsureIdentity(
	_ context.Context,
	userID uint64,
	provider, subject string,
) error {
	s.ensureIdentityCalls++
	s.ensuredUserID = userID
	s.ensuredProvider = provider
	s.ensuredSubject = subject
	return s.err
}

func (s *upsertOidcIdentitySpy) ListByUserID(context.Context, uint64) ([]domain.UserIdentity, error) {
	return nil, nil
}

// newUpsertUserUseCase はテスト用の依存（oidc spy は既定・txManager は no-op fake）で
// UpsertUserFromIDTokenUseCase を組み立てる。
func newUpsertUserUseCase(users *upsertUserRepoSpy) (*UpsertUserFromIDTokenUseCase, *upsertOidcIdentitySpy) {
	oidc := &upsertOidcIdentitySpy{}
	return NewUpsertUserFromIDTokenUseCase(users, oidc, fakeTxManager{}), oidc
}

// 招待ゲートは撤去済み（個人サインアップ）。ワークスペース所属は段 2 以降
// workspace_members が正本で、ここでは作らない（EnsurePersonalWorkspaceUseCase が別途担う）。
func Test_UpsertUserFromIDToken_新規ユーザーは自己サインアップできる(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "new-sub",
			Email:         "new@example.com",
			EmailVerified: true,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("新規ユーザーは自己サインアップできるべき")
	}
	if users.created == nil {
		t.Fatal("ユーザーが作成されていない")
	}
}

// 新規ユーザ作成時に id_token の name claim が Name に使われる（email にフォールバックしない）。
func Test_UpsertUserFromIDToken_新規はOIDC名をメールより優先(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "new-sub",
			Email:         "taro@example.com",
			EmailVerified: true,
			Name:          "山田 太郎",
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("新規ユーザーは許可されるべき")
	}
	if users.created.Name != "山田 太郎" {
		t.Fatalf("name = %q, want %q", users.created.Name, "山田 太郎")
	}
}

// name claim が無いケースは email にフォールバックする。
func Test_UpsertUserFromIDToken_新規でOIDC名なしはメールにフォールバック(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "new-sub",
			Email:         "a@example.com",
			EmailVerified: true,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("新規ユーザーは許可されるべき")
	}
	if users.created.Name != "a@example.com" {
		t.Fatalf("name = %q, want %q (fallback)", users.created.Name, "a@example.com")
	}
}

func Test_UpsertUserFromIDToken_ユーザー検索が失敗する(t *testing.T) {
	userFindErr := errors.New("user lookup failed")
	users := &upsertUserRepoSpy{stubUserRepo: stubUserRepo{err: userFindErr}}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{Subject: "user-error-sub"},
	)

	if user != nil {
		t.Fatal("検索エラー時に許可してはいけない")
	}
	if !errors.Is(err, userFindErr) {
		t.Fatalf("error = %v, want wrapped %v", err, userFindErr)
	}
	if !strings.Contains(err.Error(), "find user by oidc subject") {
		t.Fatalf("error = %q, want message containing %q", err.Error(), "find user by oidc subject")
	}
}

func Test_UpsertUserFromIDToken_Subjectが空なら処理しない(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject: "",
			Email:   "user@example.com",
		},
	)

	if user != nil {
		t.Fatal("Subjectが空のユーザーを許可してはいけない")
	}
	if err == nil {
		t.Fatal("Subjectが空の場合はエラーを返すべき")
	}
	if !strings.Contains(err.Error(), "id_token missing sub") {
		t.Fatalf("error = %q, want message containing %q", err.Error(), "id_token missing sub")
	}
	if users.findByOidcSubjectCalls != 0 {
		t.Fatalf("FindByOidcSubject calls = %d, want 0", users.findByOidcSubjectCalls)
	}
	if users.createCalls != 0 {
		t.Fatalf("Create calls = %d, want 0", users.createCalls)
	}
}

// Test_UpsertUserFromIDToken_同じemailでの同時サインアップはErrEmailTakenを返す は、
// repository.ErrEmailTaken をそのまま呼び出し元へ返すことを固定する
// （呼び出し元の 403/409 の出し分けが前提にする契約）。
func Test_UpsertUserFromIDToken_同じemailでの同時サインアップはErrEmailTakenを返す(t *testing.T) {
	users := &upsertUserRepoSpy{createErr: repository.ErrEmailTaken}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "race-sub",
			Email:         "race@example.com",
			EmailVerified: true,
		},
	)

	if user != nil {
		t.Fatal("email 衝突時にユーザーを返してはいけない")
	}
	if !errors.Is(err, repository.ErrEmailTaken) {
		t.Fatalf("error = %v, want wrapped %v", err, repository.ErrEmailTaken)
	}
}

func Test_UpsertUserFromIDToken_ユーザー作成に失敗する(t *testing.T) {
	mutationErr := errors.New("create failed")
	users := &upsertUserRepoSpy{createErr: mutationErr}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "new-user-error",
			Email:         "new-user@example.com",
			EmailVerified: true,
		},
	)

	if user != nil {
		t.Fatal("作成失敗時に許可してはいけない")
	}
	if !errors.Is(err, mutationErr) {
		t.Fatalf("error = %v, want wrapped %v", err, mutationErr)
	}
	if users.createCalls != 1 {
		t.Fatalf("Create calls = %d, want 1", users.createCalls)
	}
}

func Test_UpsertUserFromIDToken_新規作成でOIDCidentityを対で作る(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, oidc := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "new-sub-1",
			Email:         "new@example.com",
			EmailVerified: true,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("新規ユーザーは許可されるべき")
	}
	// 新規ユーザーは users 行と identity を同じ DoInTx の中で不可分に作る。
	if users.createCalls != 1 {
		t.Fatalf("Create calls = %d, want 1", users.createCalls)
	}
	if oidc.ensureIdentityCalls != 1 {
		t.Fatalf("EnsureIdentity calls = %d, want 1", oidc.ensureIdentityCalls)
	}
	if oidc.ensuredProvider != domain.OidcProviderDefault {
		t.Fatalf("provider = %q, want %q", oidc.ensuredProvider, domain.OidcProviderDefault)
	}
	if oidc.ensuredSubject != "new-sub-1" {
		t.Fatalf("subject = %q, want %q", oidc.ensuredSubject, "new-sub-1")
	}
}

func Test_UpsertUserFromIDToken_既存ユーザーでもidentityをセルフヒールする(t *testing.T) {
	existing := &domain.User{ID: 77, Email: "e@example.com"}
	users := &upsertUserRepoSpy{stubUserRepo: stubUserRepo{user: existing}}
	uc, oidc := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject: "old-sub",
			Email:   "e@example.com",
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("既存ユーザーは許可されるべき")
	}
	if oidc.ensureIdentityCalls != 1 {
		t.Fatalf("EnsureIdentity calls = %d, want 1（セルフヒールされていない）", oidc.ensureIdentityCalls)
	}
	if oidc.ensuredUserID != 77 {
		t.Fatalf("ensured userID = %d, want 77", oidc.ensuredUserID)
	}
	if oidc.ensuredSubject != "old-sub" {
		t.Fatalf("subject = %q, want %q", oidc.ensuredSubject, "old-sub")
	}
}

// 既存ユーザの Name が email と一致 + id_token に name → name で上書きされる。
func Test_UpsertUserFromIDToken_既存ユーザーは表示名をOIDCから補完(t *testing.T) {
	existing := &domain.User{ID: 5, Email: "old@example.com", Name: "old@example.com"}
	users := &upsertUserRepoSpy{stubUserRepo: stubUserRepo{user: existing}}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject: "exists",
			Email:   "old@example.com",
			Name:    "本名 太郎",
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("既存ユーザーは許可されるべき")
	}
	if users.nameUpdateCalls != 1 {
		t.Fatalf("UpdateName calls = %d, want 1", users.nameUpdateCalls)
	}
}

// 既存ユーザが既にプロフィール編集済（Name != email）なら OIDC name で上書きしない。
func Test_UpsertUserFromIDToken_表示名カスタム済みは補完しない(t *testing.T) {
	existing := &domain.User{ID: 5, Email: "u@example.com", Name: "ユーザ自身が編集した名前"}
	users := &upsertUserRepoSpy{stubUserRepo: stubUserRepo{user: existing}}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject: "exists",
			Email:   "u@example.com",
			Name:    "Google Name",
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("既存ユーザーは許可されるべき")
	}
	if users.nameUpdateCalls != 0 {
		t.Fatalf("expected no backfill, but UpdateName called %d times", users.nameUpdateCalls)
	}
}

func Test_UpsertUserFromIDToken_名前補完の更新に失敗する(t *testing.T) {
	mutationErr := errors.New("mutation failed")
	users := &upsertUserRepoSpy{
		stubUserRepo: stubUserRepo{
			user: &domain.User{ID: 7, Email: "existing@example.com", Name: "existing@example.com"},
		},
		nameUpdateErr: mutationErr,
	}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject: "existing-user",
			Email:   "existing@example.com",
			Name:    "OIDC User",
		},
	)

	if user != nil {
		t.Fatal("名前補完の更新失敗時にユーザーを許可してはいけない")
	}
	if !errors.Is(err, mutationErr) {
		t.Fatalf("error = %v, want wrapped %v", err, mutationErr)
	}
	if users.nameUpdateCalls != 1 {
		t.Fatalf("UpdateName calls = %d, want 1", users.nameUpdateCalls)
	}
}

// 保存されるのは生の claim 値ではなく正規形。生値のまま保存すると、以後の
// byte 一致検索・一意索引と食い違う。
func Test_UpsertUserFromIDToken_emailは正規形で保存する(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "member-sub",
			Email:         " Member@Example.com ",
			EmailVerified: true,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("許可されるべき")
	}
	if users.created == nil {
		t.Fatal("ユーザーが作成されていない")
	}
	if users.created.Email != "member@example.com" {
		t.Fatalf("保存された email = %q, want %q", users.created.Email, "member@example.com")
	}
}

// email_verified が false（または省略）のときは、新規ユーザーの email を
// 「無い」ものとして扱う。同一性は Subject だけで決める。未検証のアドレスを
// そのまま保存すると、その持ち主でない相手が本当の持ち主の登録を先に塞げてしまう。
func Test_UpsertUserFromIDToken_新規は未検証のemailを保存しない(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "unverified-sub",
			Email:         "victim@example.com",
			EmailVerified: false,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("未検証でもサインアップ自体は許可されるべき（同一性は subject だけで決まる）")
	}
	if users.created == nil {
		t.Fatal("ユーザーが作成されていない")
	}
	if users.created.Email != "" {
		t.Fatalf("未検証の email を保存してはいけない: got %q", users.created.Email)
	}
}

// email_verified が false のときは name のメールへのフォールバックも起きない
// （email 自体を「無い」ものとして扱うため）。oidcName も無ければ name は空のまま。
func Test_UpsertUserFromIDToken_新規は未検証だとnameのフォールバック先も空になる(t *testing.T) {
	users := &upsertUserRepoSpy{}
	uc, _ := newUpsertUserUseCase(users)

	_, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "unverified-noname-sub",
			Email:         "victim2@example.com",
			EmailVerified: false,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if users.created.Name != "" {
		t.Fatalf("未検証の email を name のフォールバックに使ってはいけない: got %q", users.created.Name)
	}
}

// 既存ユーザーが email を持っていない（サインアップ時点では未検証だった）状態で、
// 後日 email_verified=true のトークンでログインしてきたら、そのアドレスを付ける。
func Test_UpsertUserFromIDToken_既存ユーザーへ検証済みemailを後から付ける(t *testing.T) {
	existing := &domain.User{ID: 42, Email: ""}
	users := &upsertUserRepoSpy{stubUserRepo: stubUserRepo{user: existing}}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "now-verified-sub",
			Email:         " Now@Example.com ",
			EmailVerified: true,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if users.emailUpdateCalls != 1 {
		t.Fatalf("UpdateEmail calls = %d, want 1", users.emailUpdateCalls)
	}
	if users.emailUpdateUserID != 42 || users.emailUpdateValue != "now@example.com" {
		t.Fatalf("UpdateEmail(42, now@example.com) を期待, got UpdateEmail(%d, %q)",
			users.emailUpdateUserID, users.emailUpdateValue)
	}
	if user.Email != "now@example.com" {
		t.Fatalf("返す user にも反映されるべき: got %q", user.Email)
	}
}

// 既に email を持っている既存ユーザーは、後付けの対象にしない
// （上書きしてよいかはこの経路の関心事ではない。空だった場合だけを埋める）。
func Test_UpsertUserFromIDToken_既にemailがある既存ユーザーは上書きしない(t *testing.T) {
	existing := &domain.User{ID: 9, Email: "already@example.com"}
	users := &upsertUserRepoSpy{stubUserRepo: stubUserRepo{user: existing}}
	uc, _ := newUpsertUserUseCase(users)

	_, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "already-has-email-sub",
			Email:         "different@example.com",
			EmailVerified: true,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if users.emailUpdateCalls != 0 {
		t.Fatalf("既に email がある相手には UpdateEmail を呼んではいけない: calls=%d", users.emailUpdateCalls)
	}
}

// 未検証のトークンでは既存ユーザーへの email 後付けも起きない。
func Test_UpsertUserFromIDToken_既存ユーザーでも未検証なら後付けしない(t *testing.T) {
	existing := &domain.User{ID: 11, Email: ""}
	users := &upsertUserRepoSpy{stubUserRepo: stubUserRepo{user: existing}}
	uc, _ := newUpsertUserUseCase(users)

	_, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "still-unverified-sub",
			Email:         "maybe@example.com",
			EmailVerified: false,
		},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if users.emailUpdateCalls != 0 {
		t.Fatalf("未検証では後付けしないはず: calls=%d", users.emailUpdateCalls)
	}
}

// 後付けしようとしたアドレスが既に別のアクティブユーザーに使われていた場合は、
// ErrEmailTaken が返っても非致命に扱い、ログイン自体は成立させる
// （identity の自己修復と同じ方針。既に他人が使っている以上、今すぐ付け替えるべきではない
// というだけで、この人自身のログインを妨げる理由にはならない）。
func Test_UpsertUserFromIDToken_email後付けが競合しても非致命(t *testing.T) {
	existing := &domain.User{ID: 13, Email: ""}
	users := &upsertUserRepoSpy{
		stubUserRepo:   stubUserRepo{user: existing},
		emailUpdateErr: repository.ErrEmailTaken,
	}
	uc, _ := newUpsertUserUseCase(users)

	user, err := uc.Execute(
		context.Background(),
		UpsertUserFromIDTokenInput{
			Subject:       "conflict-sub",
			Email:         "taken@example.com",
			EmailVerified: true,
		},
	)
	if err != nil {
		t.Fatalf("email 後付けの競合でログイン自体を失敗させてはいけない: %v", err)
	}
	if user == nil {
		t.Fatal("ログインは成立するべき")
	}
	if user.Email != "" {
		t.Fatalf("後付けに失敗した以上、返す user の email も空のままのはず: got %q", user.Email)
	}
}

// setActiveUserRepoSpy は SetUserActiveUseCase / RetireSelfUseCase の呼び出しを記録する
// UserRepository の spy。
type setActiveUserRepoSpy struct {
	stubUserRepo
	updateActiveCalls  int
	updateActiveUserID uint64
	updateActiveValue  bool
	updateActiveErr    error
	softDeleteCalls    int
	softDeleteUserID   uint64
	softDeleteErr      error
}

func (s *setActiveUserRepoSpy) UpdateActive(_ context.Context, userID uint64, active bool) error {
	s.updateActiveCalls++
	s.updateActiveUserID = userID
	s.updateActiveValue = active
	return s.updateActiveErr
}

func (s *setActiveUserRepoSpy) SoftDelete(_ context.Context, userID uint64) error {
	s.softDeleteCalls++
	s.softDeleteUserID = userID
	return s.softDeleteErr
}

// membershipRepoSpy は SetUserActiveUseCase / RetireSelfUseCase が使う membershipRepository の
// 最小 spy（4 メソッドだけの narrow interface なので、フル interface を mock する
// 既存の mockKBPermissionRepo 各種は使わない — 詳細は membershipRepository の doc 参照）。
type membershipRepoSpy struct {
	isMember    bool
	isMemberErr error

	workspaces    []repository.WorkspaceWithScopeFacts
	workspacesErr error

	leaveCalls     []string // workspaceID を呼ばれた順に記録
	leaveErrByWS   map[string]error
	leaveActorSeen []uint64

	recordCalls  int
	recordAction domain.MembershipEventAction
	recordOld    *string
	recordNew    *string
	recordTarget uint64
	recordActor  uint64
	recordErr    error
	recordWSSeen string
}

func (m *membershipRepoSpy) IsWorkspaceMember(_ context.Context, _ string, _ uint64) (bool, error) {
	return m.isMember, m.isMemberErr
}

func (m *membershipRepoSpy) ListMemberWorkspaces(_ context.Context, _ uint64) ([]repository.WorkspaceWithScopeFacts, error) {
	return m.workspaces, m.workspacesErr
}

func (m *membershipRepoSpy) LeaveWorkspaceMembership(_ context.Context, workspaceID string, _, actorUserID uint64) error {
	m.leaveCalls = append(m.leaveCalls, workspaceID)
	m.leaveActorSeen = append(m.leaveActorSeen, actorUserID)
	if err, ok := m.leaveErrByWS[workspaceID]; ok {
		return err
	}
	return nil
}

func (m *membershipRepoSpy) RecordMembershipEvent(
	_ context.Context, workspaceID string, targetUserID, actorUserID uint64,
	action domain.MembershipEventAction, oldLabel, newLabel *string,
) error {
	m.recordCalls++
	m.recordWSSeen = workspaceID
	m.recordTarget = targetUserID
	m.recordActor = actorUserID
	m.recordAction = action
	m.recordOld = oldLabel
	m.recordNew = newLabel
	return m.recordErr
}

func Test_アカウント停止_自分自身は停止できない(t *testing.T) {
	uc := NewSetUserActiveUseCase(&setActiveUserRepoSpy{}, &membershipRepoSpy{}, fakeTxManager{})

	err := uc.Execute(context.Background(), SetUserActiveInput{
		WorkspaceID: "ws-1", TargetUserID: 7, ActorUserID: 7, Active: false,
	})
	if !errors.Is(err, ErrCannotSuspendSelf) {
		t.Fatalf("自分自身を対象にしたら ErrCannotSuspendSelf のはず: %v", err)
	}
}

func Test_アカウント停止_対象がそのワークスペースのメンバーでなければ拒否(t *testing.T) {
	perm := &membershipRepoSpy{isMember: false}
	users := &setActiveUserRepoSpy{stubUserRepo: stubUserRepo{user: &domain.User{ID: 7, Status: domain.UserStatusActive}}}
	uc := NewSetUserActiveUseCase(users, perm, fakeTxManager{})

	err := uc.Execute(context.Background(), SetUserActiveInput{
		WorkspaceID: "ws-1", TargetUserID: 7, ActorUserID: 1, Active: false,
	})
	if !errors.Is(err, ErrTargetNotWorkspaceMember) {
		t.Fatalf("対象が非メンバーなら ErrTargetNotWorkspaceMember のはず: %v", err)
	}
	if users.updateActiveCalls != 0 {
		t.Fatalf("権限境界を通らない限り users.status を書いてはいけない: calls=%d", users.updateActiveCalls)
	}
}

func Test_アカウント停止_成功すると停止しラベル付きで記録する(t *testing.T) {
	perm := &membershipRepoSpy{isMember: true}
	users := &setActiveUserRepoSpy{stubUserRepo: stubUserRepo{user: &domain.User{ID: 7, Status: domain.UserStatusActive}}}
	uc := NewSetUserActiveUseCase(users, perm, fakeTxManager{})

	err := uc.Execute(context.Background(), SetUserActiveInput{
		WorkspaceID: "ws-1", TargetUserID: 7, ActorUserID: 1, Active: false,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if users.updateActiveCalls != 1 || users.updateActiveUserID != 7 || users.updateActiveValue != false {
		t.Fatalf("UpdateActive(7, false) が呼ばれるはず: calls=%d id=%d active=%v",
			users.updateActiveCalls, users.updateActiveUserID, users.updateActiveValue)
	}
	if perm.recordCalls != 1 {
		t.Fatalf("監査記録が 1 件呼ばれるはず: calls=%d", perm.recordCalls)
	}
	if perm.recordAction != domain.MembershipEventSuspended {
		t.Fatalf("action は MembershipEventSuspended のはず: got %v", perm.recordAction)
	}
	if perm.recordOld == nil || *perm.recordOld != "active" {
		t.Fatalf("old label は停止前の active のはず: %v", perm.recordOld)
	}
	if perm.recordNew == nil || *perm.recordNew != "suspended" {
		t.Fatalf("new label は suspended のはず: %v", perm.recordNew)
	}
	if perm.recordWSSeen != "ws-1" || perm.recordTarget != 7 || perm.recordActor != 1 {
		t.Fatalf("workspace/target/actor が入力どおりでないといけない: ws=%s target=%d actor=%d",
			perm.recordWSSeen, perm.recordTarget, perm.recordActor)
	}
}

func Test_アカウント復帰_旧ラベルはsuspended新ラベルはactive(t *testing.T) {
	perm := &membershipRepoSpy{isMember: true}
	users := &setActiveUserRepoSpy{stubUserRepo: stubUserRepo{user: &domain.User{ID: 7, Status: domain.UserStatusSuspended}}}
	uc := NewSetUserActiveUseCase(users, perm, fakeTxManager{})

	err := uc.Execute(context.Background(), SetUserActiveInput{
		WorkspaceID: "ws-1", TargetUserID: 7, ActorUserID: 1, Active: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if users.updateActiveValue != true {
		t.Fatalf("UpdateActive の active は true のはず: got %v", users.updateActiveValue)
	}
	if perm.recordOld == nil || *perm.recordOld != "suspended" || perm.recordNew == nil || *perm.recordNew != "active" {
		t.Fatalf("old=suspended new=active のはず: old=%v new=%v", perm.recordOld, perm.recordNew)
	}
}

func Test_退会_所属する全ワークスペースを退出してから退会する(t *testing.T) {
	perm := &membershipRepoSpy{
		workspaces: []repository.WorkspaceWithScopeFacts{
			{Workspace: domain.Workspace{ID: "ws-a"}},
			{Workspace: domain.Workspace{ID: "ws-b"}},
		},
	}
	users := &setActiveUserRepoSpy{}
	uc := NewRetireSelfUseCase(users, perm, fakeTxManager{})

	if err := uc.Execute(context.Background(), 9); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(perm.leaveCalls) != 2 || perm.leaveCalls[0] != "ws-a" || perm.leaveCalls[1] != "ws-b" {
		t.Fatalf("所属する 2 つのワークスペースを順に退出するはず: %v", perm.leaveCalls)
	}
	for _, actor := range perm.leaveActorSeen {
		if actor != 9 {
			t.Fatalf("退出の actor は本人自身のはず: got %d", actor)
		}
	}
	if users.softDeleteCalls != 1 || users.softDeleteUserID != 9 {
		t.Fatalf("最後に SoftDelete(9) が呼ばれるはず: calls=%d id=%d", users.softDeleteCalls, users.softDeleteUserID)
	}
}

func Test_退会_最後のadminのワークスペースがあれば全体を断る(t *testing.T) {
	perm := &membershipRepoSpy{
		workspaces: []repository.WorkspaceWithScopeFacts{
			{Workspace: domain.Workspace{ID: "ws-a"}},
			{Workspace: domain.Workspace{ID: "ws-b"}},
		},
		leaveErrByWS: map[string]error{"ws-b": repository.ErrLastWorkspaceAdmin},
	}
	users := &setActiveUserRepoSpy{}
	uc := NewRetireSelfUseCase(users, perm, fakeTxManager{})

	err := uc.Execute(context.Background(), 9)
	if !errors.Is(err, repository.ErrLastWorkspaceAdmin) {
		t.Fatalf("ErrLastWorkspaceAdmin のはず: %v", err)
	}
	if users.softDeleteCalls != 0 {
		t.Fatalf("途中で断られたら SoftDelete は呼ばれないはず（全体が同じトランザクション）: calls=%d", users.softDeleteCalls)
	}
}
