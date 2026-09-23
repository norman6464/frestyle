package kb

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// 招待の定数。SQL には間隔そのものを書かず、ここで計算した時刻を渡す（invitation.sql 冒頭）。
const (
	// InvitationTTL は発行・再送から承諾できる期間。
	InvitationTTL = 7 * 24 * time.Hour
	// InvitationResendInterval は同じ宛先 × 場所へ続けて送れる最短の間隔（連打で相手の受信箱を
	// 埋めない・送信基盤の評判を落とさない）。
	InvitationResendInterval = 10 * time.Minute
	// InvitationDailyLimitPerInviter は 1 人の admin が 24 時間に届けられる回数（発行 + 再送。
	// 送信履歴 invitation_sends を数える）。
	InvitationDailyLimitPerInviter = 50
	// InvitationDailyLimitPerEmail は同じ宛先へ 24 時間に届けられる件数（全ワークスペース横断）。
	// 招待を使った嫌がらせ（見知らぬ人へ大量に送る）の上限。
	InvitationDailyLimitPerEmail = 5
	// InvitationOpenLimitPerWorkspace はワークスペースが同時に抱えられる未決の件数。
	InvitationOpenLimitPerWorkspace = 100
	// invitationTokenBytes は招待 URL に載せるトークンの乱数バイト数（共有リンクと同じ 256 bit）。
	invitationTokenBytes = 32
	// invitationListLimit は admin の一覧が返す最大件数（未決の上限より十分大きい。履歴を含む）。
	invitationListLimit = 500
	// invitationLinkPath は「自分宛の招待」画面のパス（通知の飛び先）。
	invitationLinkPath = "/invitations"
)

// 招待の操作が通らない理由。handler が応答の形に落とす。
var (
	// ErrInvitationInviterLimit は招く側の 1 日の件数上限に達した。
	ErrInvitationInviterLimit = errors.New("inviter reached the daily invitation limit")
	// ErrInvitationEmailLimit は同じ宛先への 1 日の件数上限に達した。
	ErrInvitationEmailLimit = errors.New("email reached the daily invitation limit")
	// ErrInvitationWorkspaceLimit はワークスペースの未決の上限に達した。
	ErrInvitationWorkspaceLimit = errors.New("workspace has too many open invitations")
	// ErrInvitationEmailNotVerified はログイン中のユーザーが確認済みの email を持たない
	// （発行者が email_verified を付けなかったログインだけしていない）。宛先と突き合わせる
	// 材料が無いので、自分宛の一覧・承諾・辞退はできない。
	ErrInvitationEmailNotVerified = errors.New("current user has no verified email")
	// ErrInvitationUnavailable は案内（プレビュー）で「無い・期限切れ・結果が出ている」を
	// まとめて表す。トークンを持っているだけの相手に、どれなのかは教えない。
	ErrInvitationUnavailable = errors.New("invitation is unavailable")
	// ErrInvitationInviterNotAdmin は招いた人が今はもうその場所の admin でない。
	// 除名・降格時に未決の招待は取り消しているが、その経路を通らず admin を失う場合
	// （ワークスペースの権限を直接書き換えた等）の最後の砦。
	ErrInvitationInviterNotAdmin = errors.New("inviter is no longer an admin")
)

// hashInvitationToken はトークンを SHA-256 で縮める。DB には平文を置かない
// （共有リンクと同じ作法。総当たりが現実的でない 256 bit の乱数なので、遅いハッシュは要らない）。
func hashInvitationToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// newInvitationToken は URL に載せる平文トークンと、保存用の SHA-256 の組を作る。
func newInvitationToken() (string, []byte, error) {
	raw := make([]byte, invitationTokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, fmt.Errorf("招待トークンの生成に失敗: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, hashInvitationToken(token), nil
}

// normalizeInviteeName は表示名の前後の空白を落とし、長さを確かめる。
func normalizeInviteeName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if utf8.RuneCountInString(name) > domain.InvitationInviteeNameMaxLength {
		return "", ErrInvalidName
	}
	return name, nil
}

// InvitationMailStatus は招待メールがどうなったか。招待そのものは作れているので、画面はこれで
// 「メールを送りました」「送れなかったのでリンクを渡して」「メールは無い運用」を出し分ける。
type InvitationMailStatus string

const (
	InvitationMailSent     InvitationMailStatus = "sent"
	InvitationMailFailed   InvitationMailStatus = "failed"
	InvitationMailDisabled InvitationMailStatus = "disabled"
)

// buildInviteURL は招待メールに載せる承諾 URL（/invite#t=<token>）を組み立てる。
// origin は設定（APP_BASE_URL）。トークンはフラグメントに載せる（サーバーのログに残さない。
// frontend の buildInviteUrl と同じ形）。
func buildInviteURL(appBaseURL, token string) string {
	return strings.TrimRight(appBaseURL, "/") + "/invite#t=" + url.PathEscape(token)
}

// sendInvitationMail は DB の書き込みが済んだ**あと**に招待メールを送り、結果を状態にする。
// 失敗しても招待は残っている（再送で届け直せる）ので、エラーは返さず記録して状態で伝える。
// ログに宛先とトークンは出さない。
func sendInvitationMail(
	ctx context.Context, mailer repository.InvitationMailer, appBaseURL string,
	detail *domain.InvitationDetail, token, replyTo string,
) InvitationMailStatus {
	err := mailer.SendInvitation(ctx, repository.InvitationMail{
		To:            detail.Email,
		ToName:        detail.InviteeName,
		WorkspaceName: detail.WorkspaceName,
		InviterName:   detail.InviterName,
		ReplyTo:       replyTo,
		Role:          detail.Role,
		InviteURL:     buildInviteURL(appBaseURL, token),
		ExpiresAt:     detail.ExpiresAt,
	})
	switch {
	case err == nil:
		return InvitationMailSent
	case errors.Is(err, repository.ErrMailDisabled):
		return InvitationMailDisabled
	default:
		slog.WarnContext(ctx, "invitation mail failed (invitation kept; ask admin to resend)",
			"invitationID", detail.ID, "workspaceID", detail.WorkspaceID, "err", err)
		return InvitationMailFailed
	}
}

// replyToOf は招いた人の email（Reply-To 用）。引けなくてもメールは送るので、失敗は空文字に畳む。
func replyToOf(ctx context.Context, users repository.UserRepository, userID uint64) string {
	u, err := users.FindByID(ctx, userID)
	if err != nil || u == nil {
		return ""
	}
	return domain.NormalizeEmail(u.Email)
}

// checkInvitationSendLimits は「招く側が 1 日に届けた回数」と「その宛先へ 1 日に届いた回数」の
// 上限を確かめる。発行と再送の両方が通る（どちらも 1 回の送信として送信履歴に残る）。
func checkInvitationSendLimits(
	ctx context.Context, invitations repository.InvitationRepository, actorUserID uint64, email string, now time.Time,
) error {
	dayAgo := now.Add(-24 * time.Hour)
	sent, err := invitations.CountSentBySince(ctx, actorUserID, dayAgo)
	if err != nil {
		return err
	}
	if sent >= InvitationDailyLimitPerInviter {
		return ErrInvitationInviterLimit
	}
	toEmail, err := invitations.CountSentToEmailSince(ctx, email, dayAgo)
	if err != nil {
		return err
	}
	if toEmail >= InvitationDailyLimitPerEmail {
		return ErrInvitationEmailLimit
	}
	return nil
}

// InviteByEmailUseCase はワークスペースへ email で人を招く。
//
// 招待の行を作る（同じ宛先 × 場所に未決の行があれば再送として更新する）だけで、所属・主体・
// 付与は本人が承諾するまで発生しない。宛先に既にアカウントがあればアプリ内通知も出す。
// 招待メールは DB の書き込みを終えたあとに送り、送れなくても招待は残す（応答の Token から
// 発行者がリンクを手で渡せる）。
//
// 呼び出し側（handler）が admin であることを確かめてから呼ぶ。
type InviteByEmailUseCase struct {
	invitations   repository.InvitationRepository
	users         repository.UserRepository
	notifications repository.NotificationRepository
	tx            repository.TxManager
	mailer        repository.InvitationMailer
	appBaseURL    string
	now           func() time.Time
}

func NewInviteByEmailUseCase(
	invitations repository.InvitationRepository,
	users repository.UserRepository,
	notifications repository.NotificationRepository,
	tx repository.TxManager,
	mailer repository.InvitationMailer,
	appBaseURL string,
) *InviteByEmailUseCase {
	return &InviteByEmailUseCase{
		invitations: invitations, users: users, notifications: notifications, tx: tx,
		mailer: mailer, appBaseURL: appBaseURL, now: time.Now,
	}
}

type InviteByEmailInput struct {
	WorkspaceID string
	// WorkspaceName は通知の文面に使う（middleware が解決済みのワークスペースから渡す）。
	WorkspaceName string
	Email         string
	InviteeName   string
	Role          domain.GrantRole
	ActorUserID   uint64
}

// InviteByEmailOutput は作った（または再送した）招待と、この 1 回だけ返る平文トークン。
type InviteByEmailOutput struct {
	// Invitation は一覧と同じ形（ワークスペース名・招いた人の名前つき）。画面が発行直後の行を
	// 一覧へそのまま差し込めるようにするため、書いた直後にトークンで引き直している。
	Invitation *domain.InvitationDetail
	// Token は招待 URL（/invite#t=<token>）に載せる平文。DB には SHA-256 だけが残る。
	Token string
	// NotifiedUserID は宛先に既にアカウントがあり、アプリ内通知を出した相手。無ければ 0。
	NotifiedUserID uint64
	// MailStatus は招待メールの結果（送った / 送れなかった / 送らない運用）。
	MailStatus InvitationMailStatus
}

func (u *InviteByEmailUseCase) Execute(ctx context.Context, in InviteByEmailInput) (*InviteByEmailOutput, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ActorUserID == 0 {
		return nil, errors.New("actorUserID is required")
	}
	email, err := domain.ParseInvitationEmail(in.Email)
	if err != nil {
		return nil, err
	}
	if !in.Role.Valid() {
		return nil, ErrInvalidGrantRole
	}
	name, err := normalizeInviteeName(in.InviteeName)
	if err != nil {
		return nil, err
	}
	now := u.now()
	// 上限は「招く側」「宛先」「ワークスペース」の 3 つ。どれも読んでから書くので、同時要求で
	// 数件すり抜けることはある（上限の目的は嫌がらせと事故の抑制で、厳密な会計ではない）。
	if err := checkInvitationSendLimits(ctx, u.invitations, in.ActorUserID, email, now); err != nil {
		return nil, err
	}
	open, err := u.invitations.CountOpenInWorkspace(ctx, in.WorkspaceID)
	if err != nil {
		return nil, err
	}
	if open >= InvitationOpenLimitPerWorkspace {
		return nil, ErrInvitationWorkspaceLimit
	}

	token, tokenHash, err := newInvitationToken()
	if err != nil {
		return nil, err
	}
	out := &InviteByEmailOutput{Token: token}
	// 招待の行と通知は同じトランザクションで書く（招待だけ・通知だけが残らない）。
	err = u.tx.DoInTx(ctx, func(ctx context.Context) error {
		if _, err := u.invitations.Upsert(ctx, repository.InvitationWrite{
			WorkspaceID: in.WorkspaceID,
			Scope:       domain.InvitationScopeWorkspace,
			Role:        in.Role,
			Email:       email,
			InviteeName: name,
			TokenHash:   tokenHash,
			ActorUserID: in.ActorUserID,
			ExpiresAt:   now.Add(InvitationTTL),
			SentBefore:  now.Add(-InvitationResendInterval),
		}); err != nil {
			return err
		}
		detail, err := u.invitations.FindDetailByTokenHash(ctx, tokenHash)
		if err != nil {
			return err
		}
		out.Invitation = detail
		userID, found, err := u.users.FindActiveIDByEmail(ctx, email)
		if err != nil {
			return err
		}
		if !found || userID == in.ActorUserID {
			return nil
		}
		inviter, err := u.users.FindDisplayByID(ctx, in.ActorUserID)
		if err != nil {
			return err
		}
		title := fmt.Sprintf("ワークスペース「%s」に招待されました", in.WorkspaceName)
		if inviter != nil && inviter.Name != "" {
			title = fmt.Sprintf("%s さんがワークスペース「%s」に招待しました", inviter.Name, in.WorkspaceName)
		}
		if err := u.notifications.Create(ctx, &domain.Notification{
			UserID:   userID,
			Type:     domain.NotificationTypeWorkspaceInvitation,
			Title:    title,
			Body:     "招待を確認して、参加するかどうかを選んでください。",
			LinkPath: invitationLinkPath,
		}); err != nil {
			return err
		}
		out.NotifiedUserID = userID
		return nil
	})
	if err != nil {
		return nil, err
	}
	// メールはトランザクションの外で送る（ネットワーク待ちで DB のロックを抱えない。失敗しても
	// 招待は残す）。
	out.MailStatus = sendInvitationMail(ctx, u.mailer, u.appBaseURL, out.Invitation, token, replyToOf(ctx, u.users, in.ActorUserID))
	return out, nil
}

// ListWorkspaceInvitationsUseCase は admin 向けに、ワークスペースの招待（結果が出たものも含む）を
// 新しい順で返す。呼び出し側が admin であることを確かめてから呼ぶ。
type ListWorkspaceInvitationsUseCase struct {
	invitations repository.InvitationRepository
}

func NewListWorkspaceInvitationsUseCase(invitations repository.InvitationRepository) *ListWorkspaceInvitationsUseCase {
	return &ListWorkspaceInvitationsUseCase{invitations: invitations}
}

type ListWorkspaceInvitationsInput struct {
	WorkspaceID string
}

func (u *ListWorkspaceInvitationsUseCase) Execute(ctx context.Context, in ListWorkspaceInvitationsInput) ([]domain.InvitationDetail, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.invitations.ListByWorkspace(ctx, in.WorkspaceID, invitationListLimit)
}

// ResendInvitationUseCase は未決の招待のトークンを差し替えて期限を延ばし、招待メールを送り直す
// （admin の「もう一度送る」）。前のトークンで開いた URL は使えなくなる。
type ResendInvitationUseCase struct {
	invitations repository.InvitationRepository
	users       repository.UserRepository
	mailer      repository.InvitationMailer
	appBaseURL  string
	now         func() time.Time
}

func NewResendInvitationUseCase(
	invitations repository.InvitationRepository,
	users repository.UserRepository,
	mailer repository.InvitationMailer,
	appBaseURL string,
) *ResendInvitationUseCase {
	return &ResendInvitationUseCase{
		invitations: invitations, users: users, mailer: mailer, appBaseURL: appBaseURL, now: time.Now,
	}
}

type ResendInvitationInput struct {
	WorkspaceID  string
	InvitationID string
	ActorUserID  uint64
}

type ResendInvitationOutput struct {
	Invitation *domain.InvitationDetail
	Token      string
	MailStatus InvitationMailStatus
}

func (u *ResendInvitationUseCase) Execute(ctx context.Context, in ResendInvitationInput) (*ResendInvitationOutput, error) {
	if in.WorkspaceID == "" || in.InvitationID == "" {
		return nil, repository.ErrInvitationNotFound
	}
	if in.ActorUserID == 0 {
		return nil, errors.New("actorUserID is required")
	}
	// 再送も「届ける」なので、発行と同じ 1 日の上限（招く側・宛先）を数える。ここを数えないと、
	// 再送を繰り返すだけで上限を回れる。宛先を知るために先に招待を引く（無ければここで NotFound）。
	inv, err := u.invitations.Find(ctx, in.WorkspaceID, in.InvitationID)
	if err != nil {
		return nil, err
	}
	now := u.now()
	if err := checkInvitationSendLimits(ctx, u.invitations, in.ActorUserID, inv.Email, now); err != nil {
		return nil, err
	}
	token, tokenHash, err := newInvitationToken()
	if err != nil {
		return nil, err
	}
	if _, err := u.invitations.Refresh(ctx, repository.InvitationRefresh{
		WorkspaceID:  in.WorkspaceID,
		InvitationID: in.InvitationID,
		TokenHash:    tokenHash,
		ExpiresAt:    now.Add(InvitationTTL),
		SentBefore:   now.Add(-InvitationResendInterval),
		ActorUserID:  in.ActorUserID,
	}); err != nil {
		return nil, err
	}
	detail, err := u.invitations.FindDetailByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil, err
	}
	status := sendInvitationMail(ctx, u.mailer, u.appBaseURL, detail, token, replyToOf(ctx, u.users, in.ActorUserID))
	return &ResendInvitationOutput{Invitation: detail, Token: token, MailStatus: status}, nil
}

// RevokeInvitationUseCase は admin が招待を取り消す（冪等）。行は消さず revoked_at を立てる。
type RevokeInvitationUseCase struct {
	invitations repository.InvitationRepository
}

func NewRevokeInvitationUseCase(invitations repository.InvitationRepository) *RevokeInvitationUseCase {
	return &RevokeInvitationUseCase{invitations: invitations}
}

type RevokeInvitationInput struct {
	WorkspaceID  string
	InvitationID string
	ActorUserID  uint64
}

func (u *RevokeInvitationUseCase) Execute(ctx context.Context, in RevokeInvitationInput) error {
	if in.WorkspaceID == "" || in.InvitationID == "" {
		return repository.ErrInvitationNotFound
	}
	if in.ActorUserID == 0 {
		return errors.New("actorUserID is required")
	}
	return u.invitations.Revoke(ctx, in.WorkspaceID, in.InvitationID, in.ActorUserID)
}

// PreviewInvitationUseCase は招待 URL のトークンから、ログイン前に見せる案内
// （誰から・どこへ・どの役割で・どの宛先へ）を返す。
//
// 承諾はここではできない — トークンは「案内を見る鍵」であって「入る鍵」ではない。入るには
// 宛先の email で確認済みのアカウントでログインし、AcceptInvitationUseCase を通る。
// 無い・期限切れ・結果が出ている、はどれも ErrInvitationUnavailable（区別しない）。
type PreviewInvitationUseCase struct {
	invitations repository.InvitationRepository
	now         func() time.Time
}

func NewPreviewInvitationUseCase(invitations repository.InvitationRepository) *PreviewInvitationUseCase {
	return &PreviewInvitationUseCase{invitations: invitations, now: time.Now}
}

func (u *PreviewInvitationUseCase) Execute(ctx context.Context, token string) (*domain.InvitationDetail, error) {
	if token == "" {
		return nil, ErrInvitationUnavailable
	}
	detail, err := u.invitations.FindDetailByTokenHash(ctx, hashInvitationToken(token))
	if err != nil {
		if errors.Is(err, repository.ErrInvitationNotFound) {
			return nil, ErrInvitationUnavailable
		}
		return nil, err
	}
	if !detail.Open(u.now()) {
		return nil, ErrInvitationUnavailable
	}
	return detail, nil
}

// verifiedEmailOf はログイン中のユーザーの確認済み email（正規形）を返す。
// users.email は email_verified を確認できたログインでしか入らない（UpsertUserFromIDTokenUseCase）
// ので、空でなければ確認済みとみなせる。
func verifiedEmailOf(ctx context.Context, users repository.UserRepository, userID uint64) (string, error) {
	if userID == 0 {
		return "", errors.New("userID is required")
	}
	user, err := users.FindByID(ctx, userID)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", repository.ErrUserNotFound
	}
	email := domain.NormalizeEmail(user.Email)
	if email == "" {
		return "", ErrInvitationEmailNotVerified
	}
	return email, nil
}

// ListMyInvitationsUseCase は自分宛（ログイン中のユーザーの確認済み email 宛）の未決かつ期限内の
// 招待を、全ワークスペース横断で返す。
type ListMyInvitationsUseCase struct {
	invitations repository.InvitationRepository
	users       repository.UserRepository
}

func NewListMyInvitationsUseCase(invitations repository.InvitationRepository, users repository.UserRepository) *ListMyInvitationsUseCase {
	return &ListMyInvitationsUseCase{invitations: invitations, users: users}
}

func (u *ListMyInvitationsUseCase) Execute(ctx context.Context, userID uint64) ([]domain.InvitationDetail, error) {
	email, err := verifiedEmailOf(ctx, u.users, userID)
	if err != nil {
		return nil, err
	}
	return u.invitations.ListOpenByEmail(ctx, email)
}

// AcceptInvitationUseCase は自分宛の招待を承諾する。
//
// 通る条件は 4 つ: ログイン中のユーザーが確認済み email を持つ・その email が招待の宛先と一致する・
// 招待が未決かつ期限内・招いた人が今もそのワークスペースの admin である。
// 所属・主体・付与・監査の書き込みは repository.InvitationRepository.Accept が 1 トランザクションで行う。
type AcceptInvitationUseCase struct {
	invitations repository.InvitationRepository
	users       repository.UserRepository
	workspaces  repository.KnowledgeBaseRepository
	permissions repository.KnowledgeBasePermissionRepository
	now         func() time.Time
}

func NewAcceptInvitationUseCase(
	invitations repository.InvitationRepository,
	users repository.UserRepository,
	workspaces repository.KnowledgeBaseRepository,
	permissions repository.KnowledgeBasePermissionRepository,
) *AcceptInvitationUseCase {
	return &AcceptInvitationUseCase{
		invitations: invitations, users: users, workspaces: workspaces, permissions: permissions, now: time.Now,
	}
}

type AcceptInvitationInput struct {
	InvitationID string
	UserID       uint64
}

// AcceptInvitationOutput は承諾した招待と、入った先のワークスペースの slug（画面の遷移先）。
type AcceptInvitationOutput struct {
	Invitation    *domain.Invitation
	WorkspaceSlug string
}

func (u *AcceptInvitationUseCase) Execute(ctx context.Context, in AcceptInvitationInput) (*AcceptInvitationOutput, error) {
	if in.InvitationID == "" {
		return nil, repository.ErrInvitationNotFound
	}
	email, err := verifiedEmailOf(ctx, u.users, in.UserID)
	if err != nil {
		return nil, err
	}
	inv, err := u.invitations.FindByID(ctx, in.InvitationID)
	if err != nil {
		return nil, err
	}
	// 宛先違いは「無い」と同じ応答（id を知っているだけの相手に宛先の実在を教えない）。
	if inv.Email != email {
		return nil, repository.ErrInvitationNotFound
	}
	if !inv.Open(u.now()) {
		return nil, repository.ErrInvitationNotOpen
	}
	ws, err := u.workspaces.FindWorkspaceByID(ctx, inv.WorkspaceID)
	if err != nil {
		return nil, err
	}
	if !ws.IsActive {
		return nil, repository.ErrWorkspaceNotFound
	}
	facts, err := u.permissions.WorkspacePermissionFactsForUser(ctx, inv.WorkspaceID, inv.InvitedByUserID)
	if err != nil {
		return nil, err
	}
	if !domain.ResolveScopePermission(*facts).CanManage {
		return nil, ErrInvitationInviterNotAdmin
	}
	accepted, err := u.invitations.Accept(ctx, in.InvitationID, in.UserID, email)
	if err != nil {
		return nil, err
	}
	return &AcceptInvitationOutput{Invitation: accepted, WorkspaceSlug: ws.Slug}, nil
}

// DeclineInvitationUseCase は自分宛の招待を辞退する。期限切れの招待も辞退できる（片付け）。
type DeclineInvitationUseCase struct {
	invitations repository.InvitationRepository
	users       repository.UserRepository
}

func NewDeclineInvitationUseCase(invitations repository.InvitationRepository, users repository.UserRepository) *DeclineInvitationUseCase {
	return &DeclineInvitationUseCase{invitations: invitations, users: users}
}

type DeclineInvitationInput struct {
	InvitationID string
	UserID       uint64
}

func (u *DeclineInvitationUseCase) Execute(ctx context.Context, in DeclineInvitationInput) error {
	if in.InvitationID == "" {
		return repository.ErrInvitationNotFound
	}
	email, err := verifiedEmailOf(ctx, u.users, in.UserID)
	if err != nil {
		return err
	}
	return u.invitations.Decline(ctx, in.InvitationID, in.UserID, email)
}
