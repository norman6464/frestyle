package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/profile"
)

// ProfileHandler は GET / PUT /profile/:userId(or "me")、PUT /me/status、
// GET /me/identities を提供する。返却する domain.ProfileView は users.name と
// profiles を合成したもの。
type ProfileHandler struct {
	get            *profile.GetProfileUseCase
	update         *profile.UpdateProfileUseCase
	updateStatus   *profile.UpdateStatusUseCase
	listIdentities *profile.ListMyIdentitiesUseCase
}

func NewProfileHandler(
	g *profile.GetProfileUseCase,
	u *profile.UpdateProfileUseCase,
	updateStatus *profile.UpdateStatusUseCase,
	listIdentities *profile.ListMyIdentitiesUseCase,
) *ProfileHandler {
	return &ProfileHandler{
		get:            g,
		update:         u,
		updateStatus:   updateStatus,
		listIdentities: listIdentities,
	}
}

var (
	errProfileForbidden    = errors.New("forbidden")
	errProfileUnauthorized = errors.New("unauthorized")
)

// resolveUserID は "me" / 空文字 / 数字以外を current user に、数字一致はそのまま、
// 数字で current user 以外は 403 にする（IDOR 対策）。
func (h *ProfileHandler) resolveUserID(c *gin.Context) (uint64, error) {
	cur := middleware.CurrentUserIDOrZero(c)
	if cur == 0 {
		return 0, errProfileUnauthorized
	}
	param := c.Param("userId")
	if param == "" || param == "me" {
		return cur, nil
	}
	uid, err := strconv.ParseUint(param, 10, 64)
	if err != nil {
		//nolint:nilerr // 数字以外の userId は current user にフォールバックする設計（意図的に無視）
		return cur, nil
	}
	if uid == 0 || uid != cur {
		return 0, errProfileForbidden
	}
	return uid, nil
}

// Get は指定 user のプロフィールを返す。
func (h *ProfileHandler) Get(c *gin.Context) {
	uid, err := h.resolveUserID(c)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	view, err := h.get.Execute(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, view)
}

// 各項目の上限は本文サイズの全体上限とは別に、1 項目だけ極端に大きい値が DB へ届くのを
// 入口で弾くためのもの（DB の列自体は text で無制限）。
type updateProfileReq struct {
	Name      string `json:"displayName" binding:"omitempty,max=200"`
	Bio       string `json:"bio"         binding:"omitempty,max=2000"`
	AvatarURL string `json:"avatarUrl"   binding:"omitempty,max=2000"`
	IconURL   string `json:"iconUrl"     binding:"omitempty,max=2000"` // 旧フロント互換。avatarUrl を優先。
	Status    string `json:"status"      binding:"omitempty,max=200"`
}

// Update は current user のプロフィールを更新する。
func (h *ProfileHandler) Update(c *gin.Context) {
	uid, err := h.resolveUserID(c)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	var req updateProfileReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	name := req.Name
	avatarURL := req.AvatarURL
	if avatarURL == "" {
		avatarURL = req.IconURL
	}

	view, err := h.update.Execute(c.Request.Context(), profile.UpdateProfileInput{
		UserID:     uid,
		Name:       name,
		Bio:        req.Bio,
		AvatarURL:  avatarURL,
		StatusText: req.Status,
	})
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, view)
}

// Emoji の上限は結合絵文字（ZWJ シーケンス等）が単一の絵文字でも複数バイトになり得るため、
// 普通の一言テキストより広めに取る。
type updateStatusReq struct {
	Emoji     string     `json:"emoji"     binding:"omitempty,max=32"`
	Text      string     `json:"text"      binding:"omitempty,max=200"`
	ExpiresAt *time.Time `json:"expiresAt"` // nil/省略 = 無期限
}

// UpdateStatus は一言ステータス（絵文字・テキスト・失効時刻）だけを更新する（PUT /me/status）。
// bio / avatarUrl には触れない（Update の専管）。
func (h *ProfileHandler) UpdateStatus(c *gin.Context) {
	uid, err := h.resolveUserID(c)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	var req updateStatusReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := h.updateStatus.Execute(c.Request.Context(), profile.UpdateStatusInput{
		UserID:    uid,
		Emoji:     req.Emoji,
		Text:      req.Text,
		ExpiresAt: req.ExpiresAt,
	}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	view, err := h.get.Execute(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, view)
}

// profileIdentityResponse は認証方法 1 件の返却形（表示専用）。
type profileIdentityResponse struct {
	Provider  string    `json:"provider"`
	Subject   string    `json:"subject"`
	CreatedAt time.Time `json:"createdAt"`
}

// ListIdentities は本人の認証方法一覧を返す（GET /me/identities）。resolveUserID が現在
// ユーザー以外の数値 userId を 403 にするので、他人の subject はこの経路では読めない。
func (h *ProfileHandler) ListIdentities(c *gin.Context) {
	uid, err := h.resolveUserID(c)
	if err != nil {
		writeProfileError(c, err)
		return
	}
	identities, err := h.listIdentities.Execute(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out := make([]profileIdentityResponse, 0, len(identities))
	for _, id := range identities {
		out = append(out, profileIdentityResponse{Provider: id.Provider, Subject: id.Subject, CreatedAt: id.CreatedAt})
	}
	c.JSON(http.StatusOK, out)
}

func writeProfileError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errProfileUnauthorized):
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
	case errors.Is(err, errProfileForbidden):
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	default:
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	}
}
