package handler

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/notification"
)

type NotificationHandler struct {
	list        *notification.ListNotificationsUseCase
	markRead    *notification.MarkNotificationReadUseCase
	markAllRead *notification.MarkAllNotificationsReadUseCase
	countUnread *notification.CountUnreadNotificationsUseCase
}

func NewNotificationHandler(
	l *notification.ListNotificationsUseCase,
	m *notification.MarkNotificationReadUseCase,
	a *notification.MarkAllNotificationsReadUseCase,
	cu *notification.CountUnreadNotificationsUseCase,
) *NotificationHandler {
	return &NotificationHandler{list: l, markRead: m, markAllRead: a, countUnread: cu}
}

// List は常に認証済 current user の通知を返す。
func (h *NotificationHandler) List(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	rows, err := h.list.Execute(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// domain をそのまま返さない（userId が漏れる・domain を直すと API の形が変わる）。
	c.JSON(http.StatusOK, dto.NotificationsFromDomain(rows))
}

// MarkRead は所有者検証つきで通知を既読化する。
func (h *NotificationHandler) MarkRead(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	id, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	if err := h.markRead.Execute(c.Request.Context(), uid, id); err != nil {
		// 1 行も更新できなかった。他人の通知と存在しない id は同じ応答に畳む
		// （実在を教えない。204 を返すと既読化できていないのに呼び出し側が成功と誤判定する）。
		if errors.Is(err, domain.ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// MarkAllRead は current user の全通知をまとめて既読化する。
func (h *NotificationHandler) MarkAllRead(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if err := h.markAllRead.Execute(c.Request.Context(), uid); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// UnreadCount は current user の未読通知数を整数で返す。
func (h *NotificationHandler) UnreadCount(c *gin.Context) {
	uid := middleware.CurrentUserIDOrZero(c)
	if uid == 0 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	n, err := h.countUnread.Execute(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, n)
}
