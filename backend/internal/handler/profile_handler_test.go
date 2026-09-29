package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/profile"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

func init() {
	gin.SetMode(gin.TestMode)
}

// makeCtx は gin.Context を生成し、context に current user を埋め込んで返す。
func makeCtx(currentUserID uint64, paramUserID string) *gin.Context {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	if currentUserID != 0 {
		c.Set(middleware.ContextKeyCurrentUserID, currentUserID)
	}
	c.Params = gin.Params{{Key: "userId", Value: paramUserID}}
	return c
}

func Test_プロフィール_ユーザーID解決_meキーワード(t *testing.T) {
	h := &ProfileHandler{}
	uid, err := h.resolveUserID(makeCtx(7, "me"))
	if err != nil || uid != 7 {
		t.Fatalf("'me' should resolve to current user; got uid=%d err=%v", uid, err)
	}
}

func Test_プロフィール_ユーザーID解決_空パラメータ(t *testing.T) {
	h := &ProfileHandler{}
	uid, err := h.resolveUserID(makeCtx(7, ""))
	if err != nil || uid != 7 {
		t.Fatalf("empty param should resolve to current user; got uid=%d err=%v", uid, err)
	}
}

func Test_プロフィール_ユーザーID解決_一致する数値(t *testing.T) {
	h := &ProfileHandler{}
	uid, err := h.resolveUserID(makeCtx(7, "7"))
	if err != nil || uid != 7 {
		t.Fatalf("matching numeric should pass; got uid=%d err=%v", uid, err)
	}
}

func Test_プロフィール_ユーザーID解決_不一致の数値は禁止(t *testing.T) {
	h := &ProfileHandler{}
	if _, err := h.resolveUserID(makeCtx(7, "99")); !errors.Is(err, errProfileForbidden) {
		t.Fatalf("mismatch numeric should be forbidden; got %v", err)
	}
}

func Test_プロフィール_ユーザーID解決_カレントユーザーなしは未認証(t *testing.T) {
	h := &ProfileHandler{}
	if _, err := h.resolveUserID(makeCtx(0, "me")); !errors.Is(err, errProfileUnauthorized) {
		t.Fatalf("no current user should be unauthorized; got %v", err)
	}
}

// stubProfileUserRepo は Update 経路で使うメソッドだけ実装した UserRepository スタブ。
// 未実装メソッドは埋め込んだ nil interface 経由で panic する（呼ばれない前提の検知になる）。
type stubProfileUserRepo struct {
	repository.UserRepository
	updatedName   string
	updateCalled  bool
	foundUserName string
	findErr       error
}

func (s *stubProfileUserRepo) UpdateName(_ context.Context, _ uint64, name string) error {
	s.updateCalled = true
	s.updatedName = name
	return nil
}

func (s *stubProfileUserRepo) FindByID(_ context.Context, id uint64) (*domain.User, error) {
	if s.findErr != nil {
		return nil, s.findErr
	}
	return &domain.User{ID: id, Name: s.foundUserName}, nil
}

// stubProfileRepo は ProfileRepository の in-memory スタブ。
type stubProfileRepo struct {
	saved *domain.Profile
}

func (s *stubProfileRepo) FindByUserID(_ context.Context, userID uint64) (*domain.Profile, error) {
	if s.saved != nil {
		return s.saved, nil
	}
	return &domain.Profile{UserID: userID}, nil
}

func (s *stubProfileRepo) Upsert(_ context.Context, p *domain.Profile) error {
	s.saved = p
	return nil
}

func (s *stubProfileRepo) UpdateStatus(_ context.Context, userID uint64, emoji, text string, expiresAt *time.Time) (*domain.Profile, error) {
	p := &domain.Profile{UserID: userID, StatusEmoji: emoji, StatusText: text, StatusExpiresAt: expiresAt}
	s.saved = p
	return p, nil
}

// stubIdentityRepo は UserOidcIdentityRepository の in-memory スタブ（このファイルの
// テストでは認証方法一覧の中身までは検証しない）。
type stubIdentityRepo struct{}

func (stubIdentityRepo) EnsureIdentity(context.Context, uint64, string, string) error { return nil }

func (stubIdentityRepo) ListByUserID(context.Context, uint64) ([]domain.UserIdentity, error) {
	return nil, nil
}

// doProfileUpdate は PUT /profile/me を httptest で実行し recorder と stub を返す。
func doProfileUpdate(t *testing.T, body string) (*httptest.ResponseRecorder, *stubProfileUserRepo, *stubProfileRepo) {
	t.Helper()
	users := &stubProfileUserRepo{foundUserName: "既存の名前"}
	profiles := &stubProfileRepo{}
	h := NewProfileHandler(
		profile.NewGetProfileUseCase(profiles, users),
		profile.NewUpdateProfileUseCase(profiles, users),
		profile.NewUpdateStatusUseCase(profiles),
		profile.NewListMyIdentitiesUseCase(stubIdentityRepo{}),
	)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.ContextKeyCurrentUserID, uint64(7))
	c.Params = gin.Params{{Key: "userId", Value: "me"}}
	c.Request = httptest.NewRequest("PUT", "/profile/me", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.Update(c)
	return w, users, profiles
}

func Test_プロフィール取得_User取得失敗時は200を返さない(t *testing.T) {
	users := &stubProfileUserRepo{
		findErr: errors.New("find user failed"),
	}
	profiles := &stubProfileRepo{}

	h := NewProfileHandler(
		profile.NewGetProfileUseCase(profiles, users),
		profile.NewUpdateProfileUseCase(profiles, users),
		profile.NewUpdateStatusUseCase(profiles),
		profile.NewListMyIdentitiesUseCase(stubIdentityRepo{}),
	)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.ContextKeyCurrentUserID, uint64(7))
	c.Params = gin.Params{{Key: "userId", Value: "me"}}
	c.Request = httptest.NewRequest("GET", "/profile/me", nil)

	h.Get(c)

	if w.Code != 400 {
		t.Fatalf("FindByID失敗時は200を返さないはず: status=%d body=%s", w.Code, w.Body.String())
	}
}

func Test_ステータス更新_User取得失敗時は200を返さない(t *testing.T) {
	users := &stubProfileUserRepo{
		findErr: errors.New("find user failed"),
	}
	profiles := &stubProfileRepo{}

	h := NewProfileHandler(
		profile.NewGetProfileUseCase(profiles, users),
		profile.NewUpdateProfileUseCase(profiles, users),
		profile.NewUpdateStatusUseCase(profiles),
		profile.NewListMyIdentitiesUseCase(stubIdentityRepo{}),
	)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set(middleware.ContextKeyCurrentUserID, uint64(7))
	c.Request = httptest.NewRequest("PUT", "/me/status", strings.NewReader(`{}`))
	c.Request.Header.Set("Content-Type", "application/json")

	h.UpdateStatus(c)

	if w.Code != 400 {
		t.Fatalf("FindByID失敗時は200を返さないはず: status=%d body=%s", w.Code, w.Body.String())
	}
}

func Test_プロフィール更新_displayNameキーで氏名がUpdateNameに渡る(t *testing.T) {
	// フロント (UpdateProfileRequest) の実送信キーは displayName。
	// 旧タグ json:"name" ではここが常に空になり氏名が保存されなかった。
	w, users, profiles := doProfileUpdate(t, `{"displayName":"河野拓真","bio":"自己紹介","status":"勤務中"}`)
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if !users.updateCalled || users.updatedName != "河野拓真" {
		t.Fatalf("UpdateName should be called with 河野拓真; called=%v name=%q", users.updateCalled, users.updatedName)
	}
	if profiles.saved == nil || profiles.saved.Bio != "自己紹介" || profiles.saved.StatusText != "勤務中" {
		t.Fatalf("bio/status should be upserted together; got %+v", profiles.saved)
	}
}

func Test_プロフィール更新_氏名省略時はUpdateNameを呼ばない(t *testing.T) {
	w, users, profiles := doProfileUpdate(t, `{"bio":"自己紹介のみ"}`)
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	if users.updateCalled {
		t.Fatalf("UpdateName should not be called when displayName is omitted")
	}
	if profiles.saved == nil || profiles.saved.Bio != "自己紹介のみ" {
		t.Fatalf("bio should still be upserted; got %+v", profiles.saved)
	}
}

func Test_プロフィール更新_各項目に長さの上限がある(t *testing.T) {
	tooLongName := strings.Repeat("あ", 201)
	w, users, profiles := doProfileUpdate(t, `{"displayName":"`+tooLongName+`"}`)
	if w.Code != 400 {
		t.Fatalf("displayName が上限（200）を超えたら 400 のはず: status=%d body=%s", w.Code, w.Body.String())
	}
	if users.updateCalled {
		t.Fatal("入力検証で落ちた要求は UpdateName まで届かないはず")
	}
	if profiles.saved != nil {
		t.Fatal("入力検証で落ちた要求は Upsert まで届かないはず")
	}

	tooLongBio := strings.Repeat("a", 2001)
	w2, _, _ := doProfileUpdate(t, `{"bio":"`+tooLongBio+`"}`)
	if w2.Code != 400 {
		t.Fatalf("bio が上限（2000）を超えたら 400 のはず: status=%d", w2.Code)
	}
}

func Test_プロフィール表示_JSONの氏名キーはdisplayName(t *testing.T) {
	// フロントの Profile 型は displayName を読む。name で返すと氏名欄・ヘッダーが空になる。
	b, err := json.Marshal(domain.ProfileView{Name: "河野拓真"})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	if m["displayName"] != "河野拓真" {
		t.Fatalf(`ProfileView JSON should expose displayName; got %v`, m)
	}
	if _, ok := m["name"]; ok {
		t.Fatalf("ProfileView JSON should not expose legacy key name; got %v", m)
	}
}
