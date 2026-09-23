package domain

import (
	"errors"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

// InvitationScope は招待の「場所」の種類（invitations.scope）。承諾時にどの表へ付与を張るかが
// これで決まる。ワークスペース宛は所属 + workspace_grants、スペース宛 / ページ宛は
// ゲスト（所属は作らず space_grants / page_grants だけ）。
type InvitationScope string

const (
	InvitationScopeWorkspace InvitationScope = "workspace"
	InvitationScopeSpace     InvitationScope = "space"
	InvitationScopePage      InvitationScope = "page"
)

// Valid は既知の scope かを返す。
func (s InvitationScope) Valid() bool {
	switch s {
	case InvitationScopeWorkspace, InvitationScopeSpace, InvitationScopePage:
		return true
	}
	return false
}

// InvitationStatus は招待の状態。列としては持たず、日時列と now から導く（Invitation.Status）。
type InvitationStatus string

const (
	// InvitationStatusPending は未決かつ期限内（承諾できる）。
	InvitationStatusPending InvitationStatus = "pending"
	// InvitationStatusExpired は未決のまま期限を過ぎた。再送すれば pending に戻る。
	InvitationStatusExpired  InvitationStatus = "expired"
	InvitationStatusAccepted InvitationStatus = "accepted"
	InvitationStatusDeclined InvitationStatus = "declined"
	InvitationStatusRevoked  InvitationStatus = "revoked"
)

// NotificationTypeWorkspaceInvitation は、既にアカウントのある人を招いたときに出すアプリ内通知の種類。
const NotificationTypeWorkspaceInvitation = "workspace_invitation"

// InvitationEmailMaxLength は宛先の最大長（RFC 5321 の path 上限。DB の CHECK と同じ値）。
const InvitationEmailMaxLength = 254

// InvitationInviteeNameMaxLength は招いた人が付ける相手の表示名の最大長（invitee_name の列幅）。
const InvitationInviteeNameMaxLength = 200

// ErrInvalidInvitationEmail は宛先がメールアドレスとして読めないときに返す。
var ErrInvalidInvitationEmail = errors.New("invalid invitation email")

// ParseInvitationEmail は入力の宛先を検査し、正規形（NormalizeEmail）で返す。
//
// 受け付けるのは "user@example.com" の形だけ。"名前 <user@example.com>" のような表示名付きは
// 断る — 表示名は invitee_name として別に受けるので、宛先の欄に混ざると「誰に送るか」が
// 二通りに読める。net/mail の構文検査は緩い（ローカル部の quoting 等も通す）が、形式の厳密さより
// 「明らかな打ち間違い（@ が無い・空）を弾く」ことが目的で、届くかどうかは送って初めて分かる。
func ParseInvitationEmail(raw string) (string, error) {
	trimmed := strings.Trim(raw, EmailTrimCutset)
	if trimmed == "" || utf8.RuneCountInString(trimmed) > InvitationEmailMaxLength {
		return "", ErrInvalidInvitationEmail
	}
	// 表示名付き（"x <a@b>"）や複数指定（"a@b, c@d"）は ParseAddress が Name を立てるか失敗する。
	// 角括弧を含む入力は Name が空でも断る（"<a@b>" は ParseAddress が通してしまう）。
	if strings.ContainsAny(trimmed, "<>,") {
		return "", ErrInvalidInvitationEmail
	}
	addr, err := mail.ParseAddress(trimmed)
	if err != nil || addr.Name != "" {
		return "", ErrInvalidInvitationEmail
	}
	normalized := NormalizeEmail(addr.Address)
	// ck_invitations_email_normalized と同じ最小条件（@ が 2 文字目以降・254 文字以下）を
	// アプリ側でも確かめる（DB の制約違反を 500 にしない）。
	if strings.Index(normalized, "@") < 1 || len(normalized) > InvitationEmailMaxLength {
		return "", ErrInvalidInvitationEmail
	}
	return normalized, nil
}

// Invitation は「このメールアドレスの人を、この場所に、この役割で入れたい」という admin の意思 1 件。
//
// 承諾されるまで所属（workspace_members）にも主体（principals）にも付与（*_grants）にも何も
// 書かない。承諾した瞬間に、それらをこの行の AcceptedAt と同じトランザクションで作る。
// 相手は users.id ではなく email で指す — まだアカウントの無い人も招けるし、id を渡して
// 「実在する id なら 204」で他人の実在を探れる口にもならない。
//
// 表の設計（1 表で 3 種類の場所を持つ理由、状態を列で持たない理由、users へ FK を張らない
// 理由）は schema.hcl の table "invitations" のコメントを見る。
type Invitation struct {
	ID          string          `json:"id"`
	WorkspaceID string          `json:"workspaceId"`
	Scope       InvitationScope `json:"scope"`
	// SpaceID は Scope が space のときだけ入る。
	SpaceID *string `json:"spaceId,omitempty"`
	// PageID は Scope が page のときだけ入る。
	PageID *string `json:"pageId,omitempty"`
	// Role は承諾時にその場所へ張る役割。
	Role GrantRole `json:"role"`
	// Email は宛先の正規形（NormalizeEmail）。
	Email string `json:"email"`
	// InviteeName は招いた人が付けた相手の表示名（無ければ空文字）。users.name には影響しない。
	InviteeName string `json:"inviteeName"`
	// TokenHash は招待 URL に載せるトークンの SHA-256（32 バイト）。平文は発行・再送の応答で
	// 1 回返るだけで保存しない。API へは絶対に出さない。
	TokenHash []byte `json:"-"`
	// InvitedByUserID は最初に招いた人。承諾時に「今もその場所の admin か」を再判定する。
	InvitedByUserID uint64 `json:"invitedByUserId"`
	// ExpiresAt は承諾できる期限。列は書き換えず now との比較で失効し、再送で延びる。
	ExpiresAt time.Time `json:"expiresAt"`
	// LastSentAt / LastSentByUserID / SendCount は最後に届けた時刻・実行者・回数（再送の間隔判定と表示用）。
	LastSentAt       time.Time `json:"lastSentAt"`
	LastSentByUserID uint64    `json:"lastSentByUserId"`
	SendCount        int       `json:"sendCount"`
	// 結果は高々 1 つ（承諾 / 辞退 / 取消）。「いつ」と「誰が」は必ず対。
	AcceptedAt       *time.Time `json:"acceptedAt,omitempty"`
	AcceptedByUserID *uint64    `json:"acceptedByUserId,omitempty"`
	DeclinedAt       *time.Time `json:"declinedAt,omitempty"`
	DeclinedByUserID *uint64    `json:"declinedByUserId,omitempty"`
	RevokedAt        *time.Time `json:"revokedAt,omitempty"`
	RevokedByUserID  *uint64    `json:"revokedByUserId,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// Unresolved は結果（承諾・辞退・取消）がまだ出ていないかを返す。期限切れも含む —
// 部分一意索引 uq_invitations_open_target が「未決」と数える範囲と同じ。
func (i Invitation) Unresolved() bool {
	return i.AcceptedAt == nil && i.DeclinedAt == nil && i.RevokedAt == nil
}

// Status は now の時点での状態を導く。
func (i Invitation) Status(now time.Time) InvitationStatus {
	switch {
	case i.AcceptedAt != nil:
		return InvitationStatusAccepted
	case i.DeclinedAt != nil:
		return InvitationStatusDeclined
	case i.RevokedAt != nil:
		return InvitationStatusRevoked
	case !now.Before(i.ExpiresAt):
		return InvitationStatusExpired
	default:
		return InvitationStatusPending
	}
}

// Open は now の時点で承諾できる（未決かつ期限内）かを返す。
func (i Invitation) Open(now time.Time) bool {
	return i.Status(now) == InvitationStatusPending
}

// InvitationDetail は招待 1 件に、画面に出すための周辺（ワークスペースの slug / 名前・
// 招いた人の名前）を添えたもの。一覧・案内（プレビュー）が返す。
type InvitationDetail struct {
	Invitation
	WorkspaceSlug string `json:"workspaceSlug"`
	WorkspaceName string `json:"workspaceName"`
	// InviterName は招いた人の users.name。退会・物理削除で引けなければ空文字。
	InviterName string `json:"inviterName"`
}
