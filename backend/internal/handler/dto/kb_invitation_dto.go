package dto

import (
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// KbInviteByEmailRequest は POST /kb/workspaces/:workspaceSlug/invitations の入力。
type KbInviteByEmailRequest struct {
	// Email は宛先。前後の空白と大文字小文字は正規化される。表示名付き（"x <a@b>"）は受けない。
	Email string `json:"email" binding:"required,max=320" example:"taro@example.com"`
	// Name は招く相手の表示名（任意）。一覧・案内に「○○さんへの招待」と出すためだけに使う。
	Name string `json:"name" binding:"max=200" example:"山田 太郎"`
	// Role は承諾時にワークスペース全体へ張る役割（admin / editor / commenter / viewer）。
	Role string `json:"role" binding:"required" example:"editor"`
}

// KbInvitationResponse は招待 1 件の返却形（admin の一覧・自分宛の一覧・発行直後で共通）。
// トークンは載せない（domain.Invitation の TokenHash は json:"-" だが、応答型を別に持つことで
// 「domain をそのまま返したら秘密が増えていた」事故を防ぐ）。
type KbInvitationResponse struct {
	ID string `json:"id" example:"0198a000-0000-7000-8000-00000000000d"`
	// Scope は場所の種類（workspace / space / page）。
	Scope string `json:"scope" example:"workspace"`
	// SpaceID / PageID は Scope に応じてどちらか一方だけ入る。
	SpaceID *string `json:"spaceId,omitempty"`
	PageID  *string `json:"pageId,omitempty"`
	Role    string  `json:"role" example:"editor"`
	// Email は宛先（正規形）。
	Email       string `json:"email" example:"taro@example.com"`
	InviteeName string `json:"inviteeName" example:"山田 太郎"`
	// Status は今の状態（pending / expired / accepted / declined / revoked）。サーバの時刻で導く。
	Status        string `json:"status" example:"pending"`
	WorkspaceSlug string `json:"workspaceSlug" example:"acme"`
	WorkspaceName string `json:"workspaceName" example:"Acme 社"`
	// InvitedByUserID / InviterName は最初に招いた人。名前は退会・削除で引けなければ空文字。
	InvitedByUserID uint64    `json:"invitedByUserId" example:"42"`
	InviterName     string    `json:"inviterName" example:"鈴木 花子"`
	ExpiresAt       time.Time `json:"expiresAt"`
	LastSentAt      time.Time `json:"lastSentAt"`
	SendCount       int       `json:"sendCount" example:"1"`
	// 結果が出ていればその時刻（高々 1 つ）。
	AcceptedAt *time.Time `json:"acceptedAt,omitempty"`
	DeclinedAt *time.Time `json:"declinedAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

// KbInvitationFromDomain は招待を応答の形にする。now は Status を導く基準時刻。
func KbInvitationFromDomain(d domain.InvitationDetail, now time.Time) KbInvitationResponse {
	return KbInvitationResponse{
		ID:              d.ID,
		Scope:           string(d.Scope),
		SpaceID:         d.SpaceID,
		PageID:          d.PageID,
		Role:            string(d.Role),
		Email:           d.Email,
		InviteeName:     d.InviteeName,
		Status:          string(d.Status(now)),
		WorkspaceSlug:   d.WorkspaceSlug,
		WorkspaceName:   d.WorkspaceName,
		InvitedByUserID: d.InvitedByUserID,
		InviterName:     d.InviterName,
		ExpiresAt:       d.ExpiresAt,
		LastSentAt:      d.LastSentAt,
		SendCount:       d.SendCount,
		AcceptedAt:      d.AcceptedAt,
		DeclinedAt:      d.DeclinedAt,
		RevokedAt:       d.RevokedAt,
		CreatedAt:       d.CreatedAt,
	}
}

// KbInvitationsFromDomain は一覧をまとめて変換する。0 件は null ではなく [] を返す。
func KbInvitationsFromDomain(ds []domain.InvitationDetail, now time.Time) []KbInvitationResponse {
	out := make([]KbInvitationResponse, 0, len(ds))
	for i := range ds {
		out = append(out, KbInvitationFromDomain(ds[i], now))
	}
	return out
}

// KbIssuedInvitationResponse は発行・再送の直後だけ返る形。token は平文で返るのはこの 1 回だけ
// （DB には SHA-256 しか残らない）。発行者は招待 URL（/invite#t=<token>）を組み立てて相手へ渡す。
type KbIssuedInvitationResponse struct {
	Invitation KbInvitationResponse `json:"invitation"`
	Token      string               `json:"token" example:"3q2-7uMBEjRWeJq83vzMzQ"`
}

// KbInvitationPreviewRequest は POST /kb/invitations/preview の入力。トークンをクエリや path では
// なくボディで受けるのは、URL に載せるとアクセスログ・プロキシのログ・履歴・Referer に残るため。
type KbInvitationPreviewRequest struct {
	Token string `json:"token" binding:"required"`
}

// KbInvitationPreviewResponse は招待 URL を開いた（まだログインしていない）人に見せる案内。
// Status が "unavailable" のときは他の項目を入れない — 無い・期限切れ・結果が出ている、の
// どれなのかをトークンを持っているだけの相手に教えないため。
type KbInvitationPreviewResponse struct {
	// Status は pending（承諾できる）または unavailable。
	Status        string `json:"status" example:"pending"`
	WorkspaceName string `json:"workspaceName,omitempty" example:"Acme 社"`
	InviterName   string `json:"inviterName,omitempty" example:"鈴木 花子"`
	InviteeName   string `json:"inviteeName,omitempty" example:"山田 太郎"`
	// Email は宛先。承諾にはこの email で確認済みのアカウントでのログインが要る、と案内するために返す
	// （URL は宛先本人へ渡す前提）。
	Email     string     `json:"email,omitempty" example:"taro@example.com"`
	Role      string     `json:"role,omitempty" example:"editor"`
	Scope     string     `json:"scope,omitempty" example:"workspace"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

// KbInvitationPreviewStatusPending / Unavailable は KbInvitationPreviewResponse.Status の値。
const (
	KbInvitationPreviewStatusPending     = "pending"
	KbInvitationPreviewStatusUnavailable = "unavailable"
)

// KbInvitationPreviewFromDomain は承諾できる招待の案内を組み立てる。
func KbInvitationPreviewFromDomain(d domain.InvitationDetail) KbInvitationPreviewResponse {
	expires := d.ExpiresAt
	return KbInvitationPreviewResponse{
		Status:        KbInvitationPreviewStatusPending,
		WorkspaceName: d.WorkspaceName,
		InviterName:   d.InviterName,
		InviteeName:   d.InviteeName,
		Email:         d.Email,
		Role:          string(d.Role),
		Scope:         string(d.Scope),
		ExpiresAt:     &expires,
	}
}

// KbInvitationPreviewUnavailable は「使えない」案内（理由は伏せる）。
func KbInvitationPreviewUnavailable() KbInvitationPreviewResponse {
	return KbInvitationPreviewResponse{Status: KbInvitationPreviewStatusUnavailable}
}

// KbAcceptedInvitationResponse は承諾直後の返却形。画面はこれで入った先へ遷移する。
type KbAcceptedInvitationResponse struct {
	WorkspaceSlug string  `json:"workspaceSlug" example:"acme"`
	Scope         string  `json:"scope" example:"workspace"`
	SpaceID       *string `json:"spaceId,omitempty"`
	PageID        *string `json:"pageId,omitempty"`
}
