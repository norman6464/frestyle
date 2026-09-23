package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// fakeUserRepo は AuthHandler.upsertUserFromIDToken のテスト用 stub。
type fakeUserRepo struct {
	existingBySub      map[string]*domain.User
	findErr            error
	created            *domain.User
	createErr          error
	updateWorkspaceID  uint64
	updateWorkspaceVal *string
	updateNameID       uint64
	updateNameVal      string
	updateEmailID      uint64
	updateEmailVal     string
}

func (r *fakeUserRepo) FindByOidcSubject(_ context.Context, sub string) (*domain.User, error) {
	if r.findErr != nil {
		return nil, r.findErr
	}
	if u, ok := r.existingBySub[sub]; ok {
		return u, nil
	}
	return nil, nil
}

func (r *fakeUserRepo) OidcSubjectByUserID(_ context.Context, _ uint64) (string, error) {
	return "", nil
}

func (r *fakeUserRepo) FindByID(_ context.Context, _ uint64) (*domain.User, error) {
	return nil, nil
}

func (r *fakeUserRepo) FindDisplayByID(_ context.Context, _ uint64) (*domain.UserDisplay, error) {
	return nil, nil
}

func (r *fakeUserRepo) FindActiveIDByEmail(context.Context, string) (uint64, bool, error) {
	return 0, false, nil
}

func (r *fakeUserRepo) Create(_ context.Context, u *domain.User) error {
	if r.createErr != nil {
		return r.createErr
	}
	u.ID = 7
	r.created = u
	return nil
}

// fakeOidcIdentityRepo は UserOidcIdentityRepository のテスト用 no-op stub。
// このファイルのテストは identity の中身までは検証しない（Create の成否だけを見る）。
type fakeOidcIdentityRepo struct{}

func (fakeOidcIdentityRepo) EnsureIdentity(context.Context, uint64, string, string) error {
	return nil
}

func (fakeOidcIdentityRepo) ListByUserID(context.Context, uint64) ([]domain.UserIdentity, error) {
	return nil, nil
}

func (r *fakeUserRepo) UpdateName(_ context.Context, id uint64, name string) error {
	r.updateNameID, r.updateNameVal = id, name
	return nil
}

func (r *fakeUserRepo) UpdateEmail(_ context.Context, id uint64, email string) error {
	r.updateEmailID, r.updateEmailVal = id, email
	return nil
}

func (r *fakeUserRepo) UpdateWorkspaceID(_ context.Context, id uint64, workspaceID *string) error {
	r.updateWorkspaceID, r.updateWorkspaceVal = id, workspaceID
	return nil
}

func (r *fakeUserRepo) UpdateActive(context.Context, uint64, bool) error { return nil }
func (r *fakeUserRepo) SoftDelete(context.Context, uint64) error         { return nil }
func (r *fakeUserRepo) ListByWorkspaceID(_ context.Context, _ string) ([]domain.User, error) {
	return nil, nil
}

// makeIDToken は claims を本物の鍵で署名した id_token にする。
// 署名を検証する側になったので、テストも実際に署名する（testIdP は oidc_testkit_test.go）。
func makeIDToken(t *testing.T, idp *testIdP, claims map[string]any) string {
	t.Helper()
	return idp.sign(t, claims)
}

// newTestAuthHandler はテスト用 AuthHandler を組み立てる。tokens は使わない。
func newTestAuthHandler(
	t *testing.T,
	idp *testIdP,
	users *fakeUserRepo,
) *AuthHandler {
	t.Helper()
	return &AuthHandler{
		verifier: idp.verifier(t),
		upsertUser: user.NewUpsertUserFromIDTokenUseCase(
			users, fakeOidcIdentityRepo{}, fakeTxManager{},
		),
	}
}

// newTestAuthHandlerWithRetire は DeleteMe（段 7・自分の退会）だけを試すための最小構成。
// perms は所属している全ワークスペースの退出に使う（kbFakePerms が
// membershipRepository の narrow interface も満たす — usecase/user.membershipRepository
// の doc 参照）。
func newTestAuthHandlerWithRetire(users *fakeUserRepo, perms *kbFakePerms) *AuthHandler {
	return &AuthHandler{
		retireSelf: user.NewRetireSelfUseCase(users, perms, fakeTxManager{}),
	}
}

func init() {
	gin.SetMode(gin.TestMode)
}

// テスト用に空の gin.Context を返す（c.Request.Context() が呼ばれるので Request も埋める）。
func newGinCtx() *gin.Context {
	c, _ := gin.CreateTestContext(nil)
	c.Request = mustNewRequest()
	return c
}

func Test_IDトークンからユーザー登録_既存ユーザーは常に許可(t *testing.T) {
	existing := &domain.User{ID: 5, Email: "u@example.com"}
	users := &fakeUserRepo{existingBySub: map[string]*domain.User{"existing": existing}}
	idp := newTestIdP(t)
	h := newTestAuthHandler(t, idp, users)

	idToken := makeIDToken(t, idp, map[string]any{
		"sub":   "existing",
		"email": "u@example.com",
	})

	allowed := upsertAllowed(h, newGinCtx(), idToken)
	if !allowed {
		t.Fatalf("existing user must always be allowed")
	}
	if users.created != nil {
		t.Fatalf("existing user must not trigger Create")
	}
}

func Test_IDトークンからユーザー登録_不正な形式のトークンを拒否(t *testing.T) {
	idp := newTestIdP(t)
	h := newTestAuthHandler(t, idp, &fakeUserRepo{})
	if upsertAllowed(h, newGinCtx(), "not-a-jwt") {
		t.Fatal("malformed token must be rejected")
	}
}

// 新規ユーザ作成時に id_token の `name` claim が Name に使われる（email にフォールバックしない）。
func Test_IDトークンからユーザー登録_新規はOIDC名をメールより優先(t *testing.T) {
	idp := newTestIdP(t)
	users := &fakeUserRepo{}
	h := newTestAuthHandler(t, idp, users)
	idToken := makeIDToken(t, idp, map[string]any{
		"sub":            "google-1",
		"email":          "taro@example.com",
		"email_verified": true,
		"name":           "山田 太郎",
	})

	if !upsertAllowed(h, newGinCtx(), idToken) {
		t.Fatal("must be allowed")
	}
	if users.created == nil {
		t.Fatal("expected user created")
	}
	if users.created.Name != "山田 太郎" {
		t.Errorf("Name = %q, want 山田 太郎 (OIDC name)", users.created.Name)
	}
}

// name claim が無いケースは email にフォールバックする（後方互換）。
func Test_IDトークンからユーザー登録_新規でOIDC名なしはメールにフォールバック(t *testing.T) {
	idp := newTestIdP(t)
	users := &fakeUserRepo{}
	h := newTestAuthHandler(t, idp, users)
	idToken := makeIDToken(t, idp, map[string]any{"sub": "g-3", "email": "a@example.com", "email_verified": true})

	if !upsertAllowed(h, newGinCtx(), idToken) {
		t.Fatal("must be allowed")
	}
	if users.created.Name != "a@example.com" {
		t.Errorf("Name = %q, want a@example.com (fallback)", users.created.Name)
	}
}

// email_verified が無い（＝未検証）トークンでは、handler が読んだクレームが
// usecase まで正しく伝わり、email を保存しないことを end-to-end で確かめる。
// usecase 単体のテストは有るが、handler 側のクレーム抽出（claims["email_verified"]）
// 自体にバグがあると usecase のテストだけでは検出できない。
func Test_IDトークンからユーザー登録_新規は未検証だとemailを保存しない(t *testing.T) {
	idp := newTestIdP(t)
	users := &fakeUserRepo{}
	h := newTestAuthHandler(t, idp, users)
	idToken := makeIDToken(t, idp, map[string]any{"sub": "unverified-g", "email": "victim@example.com"})

	if !upsertAllowed(h, newGinCtx(), idToken) {
		t.Fatal("must be allowed (同一性は subject だけで決まる)")
	}
	if users.created == nil {
		t.Fatal("expected user created")
	}
	if users.created.Email != "" {
		t.Errorf("email_verified の無いトークンから email を保存してはいけない: got %q", users.created.Email)
	}
}

// 既存ユーザの Name が email と一致 + id_token に name → name で上書きされる。
func Test_IDトークンからユーザー登録_既存ユーザーは表示名をOIDCから補完(t *testing.T) {
	idp := newTestIdP(t)
	existing := &domain.User{
		ID:    5,
		Email: "old@example.com", Name: "old@example.com",
	}
	users := &fakeUserRepo{existingBySub: map[string]*domain.User{"exists": existing}}
	h := newTestAuthHandler(t, idp, users)
	idToken := makeIDToken(t, idp, map[string]any{
		"sub": "exists", "email": "old@example.com", "name": "本名 太郎",
	})

	if !upsertAllowed(h, newGinCtx(), idToken) {
		t.Fatal("must be allowed")
	}
	if users.updateNameID != 5 || users.updateNameVal != "本名 太郎" {
		t.Errorf("expected backfill UpdateName(5, '本名 太郎'), got id=%d val=%q",
			users.updateNameID, users.updateNameVal)
	}
}

// 既存ユーザが既にプロフィール編集済（Name != email）なら OIDC name で上書きしない。
func Test_IDトークンからユーザー登録_表示名カスタム済みは補完しない(t *testing.T) {
	idp := newTestIdP(t)
	existing := &domain.User{
		ID:    5,
		Email: "u@example.com", Name: "ユーザ自身が編集した名前",
	}
	users := &fakeUserRepo{existingBySub: map[string]*domain.User{"exists": existing}}
	h := newTestAuthHandler(t, idp, users)
	idToken := makeIDToken(t, idp, map[string]any{
		"sub": "exists", "email": "u@example.com", "name": "Google Name",
	})

	if !upsertAllowed(h, newGinCtx(), idToken) {
		t.Fatal("must be allowed")
	}
	if users.updateNameVal != "" {
		t.Errorf("expected no backfill, but UpdateName called with %q", users.updateNameVal)
	}
}

func Test_IDトークンからユーザー登録_壊れたトークンを弾く(t *testing.T) {
	idp := newTestIdP(t)
	h := newTestAuthHandler(t, idp, &fakeUserRepo{})

	user, err := h.upsertUserFromIDToken(newGinCtx(), "invalid-id-token")

	if user != nil {
		t.Fatal("不正な id_token を許可してはいけない")
	}
	if !errors.Is(err, errIDTokenRejected) {
		t.Fatalf("id_token の拒否として返っていない: %v", err)
	}
}

// 署名が正しくても、別の発行者・別の宛先のトークンは通さない。
// 1 つの発行者が複数のアプリにトークンを出す構成では、ここを見ないと
// 隣のアプリのトークンがそのまま通る。
func Test_IDトークンからユーザー登録_宛先違いを弾く(t *testing.T) {
	idp := newTestIdP(t)
	h := newTestAuthHandler(t, idp, &fakeUserRepo{})

	// aud だけを不正にする。ほかの必須クレームは有効なままにしておく
	// （そうしないと、aud の検査を外しても別の理由で落ちてテストが通ってしまう）。
	idToken := idp.signExact(t, map[string]any{
		"iss":   testIssuer,
		"aud":   "someone-elses-client",
		"sub":   "u1",
		"email": "u@example.com",
		"iat":   time.Now().Add(-time.Minute).Unix(),
		"exp":   time.Now().Add(time.Hour).Unix(),
	})

	user, err := h.upsertUserFromIDToken(newGinCtx(), idToken)
	if user != nil {
		t.Fatal("別のアプリ宛のトークンを許可してはいけない")
	}
	if !errors.Is(err, errIDTokenRejected) {
		t.Fatalf("id_token の拒否として返っていない: %v", err)
	}
}

// doDeleteMe は DeleteMe を本物の gin ルーターへ登録して叩く。
//
// c.Status だけを呼ぶ応答（204 No Content）は gin の遅延書き込み
// （c.Writer.WriteHeaderNow）が Write を伴わないと確定しない。ServeHTTP を通した
// 完全なリクエストサイクルでないと httptest.ResponseRecorder.Code に反映されないため、
// handler を直接呼ぶ newGinCtx 方式ではなく、ここだけ本物のルーターを組み立てる。
func doDeleteMe(t *testing.T, h *AuthHandler, uid uint64) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if uid != 0 {
		r.Use(func(c *gin.Context) {
			c.Set(middleware.ContextKeyCurrentUserID, uid)
			c.Next()
		})
	}
	r.DELETE("/auth/me", h.DeleteMe)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodDelete, "/auth/me", nil))
	return w
}

func Test_退会_未認証は401(t *testing.T) {
	h := newTestAuthHandlerWithRetire(&fakeUserRepo{}, newKbFakePerms(newKbFakePages(), domain.PagePermission{}))

	w := doDeleteMe(t, h, 0)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("未認証は 401 のはず: got %d body=%s", w.Code, w.Body.String())
	}
}

func Test_退会_所属が無ければそのまま退会できる(t *testing.T) {
	users := &fakeUserRepo{}
	h := newTestAuthHandlerWithRetire(users, newKbFakePerms(newKbFakePages(), domain.PagePermission{}))

	w := doDeleteMe(t, h, 9)

	if w.Code != http.StatusNoContent {
		t.Fatalf("成功は 204 のはず: got %d body=%s", w.Code, w.Body.String())
	}
}

func Test_退会_最後のadminのワークスペースがあれば409(t *testing.T) {
	pages := newKbFakePages()
	pages.addWorkspace(kbWorkspaceID, kbWorkspaceSlug)
	perms := newKbFakePerms(pages, domain.PagePermission{})
	// ListMemberWorkspaces がこのワークスペースを返すよう所属だけ作る。
	perms.addMember(kbWorkspaceID, kbUserID)
	// 本物の repository は「最後の admin の退会」を書き込みと同じトランザクションで断る
	// （LeaveWorkspaceMembership 内で admin 人数を数える）。fake にその計数ロジックを
	// 持たせず、revokeGrantErr と同じ方針で戻り値を直接差し替えて経路だけ再現する。
	perms.leaveWorkspaceErr = repository.ErrLastWorkspaceAdmin

	h := newTestAuthHandlerWithRetire(&fakeUserRepo{}, perms)

	w := doDeleteMe(t, h, kbUserID)

	if w.Code != http.StatusConflict {
		t.Fatalf("最後の admin なら 409 のはず: got %d body=%s", w.Code, w.Body.String())
	}
}
