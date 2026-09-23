package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
)

// stubUsers は UserRepository の最小 stub。FindByOidcSubject だけ返す。
type stubUsers struct{ user *domain.User }

func (s *stubUsers) FindByOidcSubject(context.Context, string) (*domain.User, error) {
	return s.user, nil
}

func (s *stubUsers) FindByID(context.Context, uint64) (*domain.User, error) { return s.user, nil }

func (s *stubUsers) FindDisplayByID(context.Context, uint64) (*domain.UserDisplay, error) {
	return nil, nil
}

func (s *stubUsers) FindActiveIDByEmail(context.Context, string) (uint64, bool, error) {
	return 0, false, nil
}

func (s *stubUsers) ListByWorkspaceID(context.Context, string) ([]domain.User, error) {
	return nil, nil
}

func (s *stubUsers) Create(context.Context, *domain.User) error { return nil }

func (s *stubUsers) OidcSubjectByUserID(context.Context, uint64) (string, error) { return "", nil }
func (s *stubUsers) UpdateName(context.Context, uint64, string) error            { return nil }
func (s *stubUsers) UpdateEmail(context.Context, uint64, string) error           { return nil }
func (s *stubUsers) UpdateActive(context.Context, uint64, bool) error            { return nil }
func (s *stubUsers) SoftDelete(context.Context, uint64) error                    { return nil }

// currentUserResult は CurrentUser を通したリクエストの結果。
type currentUserResult struct {
	rec *httptest.ResponseRecorder
	// reached は CurrentUser の後ろの handler まで届いたか。遮断が「abort フラグを
	// 立てただけ」で後続を止め損ねていないかは、これを見ないと分からない。
	reached bool
	// user は後続の handler から見えた currentUser。
	user *domain.User
}

// runCurrentUser は本物のルーターに CurrentUser を載せてリクエストを 1 本通す。
// gin.CreateTestContext で middleware を直に呼ぶと chain が無いため、AbortWithStatusJSON が
// 後続を止めることを確かめられない（止め損ねても通ってしまう）。
func runCurrentUser(t *testing.T, users *stubUsers) currentUserResult {
	t.Helper()
	got := currentUserResult{rec: httptest.NewRecorder()}
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(ContextKeySubject, "sub-123") })
	r.Use(CurrentUser(users))
	r.GET("/", func(c *gin.Context) {
		got.reached = true
		got.user = CurrentUserFromContext(c)
		c.Status(http.StatusOK)
	})
	r.ServeHTTP(got.rec, httptest.NewRequest(http.MethodGet, "/", nil))
	return got
}

func Test_カレントユーザー_有効なユーザーは許可(t *testing.T) {
	users := &stubUsers{user: &domain.User{ID: 1, Status: domain.UserStatusActive}}

	got := runCurrentUser(t, users)

	if !got.reached {
		t.Fatal("有効なユーザーのリクエストは後続へ通すべき")
	}
	if got.user == nil {
		t.Fatal("currentUser が context にセットされるべき")
	}
}

func Test_カレントユーザー_無効なユーザーを遮断(t *testing.T) {
	// suspended のユーザーは即時に弾く（有効な JWT でも利用不可）。
	users := &stubUsers{user: &domain.User{ID: 1, Status: domain.UserStatusSuspended}}

	got := runCurrentUser(t, users)

	if got.rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", got.rec.Code)
	}
	if got.reached {
		t.Fatal("無効ユーザーのリクエストを後続へ通してはならない")
	}
}
