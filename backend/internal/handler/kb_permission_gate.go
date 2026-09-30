package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// ── ナレッジの「権限そのものを変える」API に共通する認可 ──
//
// 権限を書き換える usecase（GrantWorkspaceRoleUseCase / GrantSpaceRoleUseCase …）は
// 認可を一切見ない。受け取った workspaceID / spaceID / principalID をそのまま書くだけで、
// 検査するのは入力の妥当性（空文字・役割名が既知か・主体が実在するか）に限る。認可は handler が
// Check*PermissionUseCase を呼んで先に決める（ページ操作と同じ分担）。判定を usecase へ
// 持ち込まないのは、ワークスペースを確定させるのが middleware（URL の slug + principals）で、
// 呼び出し元が誰かを知っているのが handler だけだから — usecase は *gin.Context を受け取らない。
// 裏を返すと、このファイルの関数を通さずにルートを生やした時点で「ログインさえしていれば
// 誰でも自分を admin にできる」状態になる。権限操作のルートは必ず requireWorkspaceAdmin /
// requireSpaceAdmin のどちらかを最初に通すこと。ページ単位の権限と共有リンクは持たない。
//
// 特権ロール（super_admin 的なもの）は存在せず、特別扱いもしない。ナレッジの役割
// （domain.GrantRole の admin/editor/commenter/viewer）は per-workspace の grant だけで
// 閉じ、アプリ全体のグローバルなロール概念を持たない（domain/grant.go）。「特権ロールなら
// 全部できる」という分岐を 1 つでも足すと、権限の出どころが principals/grants とそれ以外の
// 2 系統になり、admin が知らないところで自分のテナントを読み書きされる（grant を全部見ても
// その事実が説明できない）。この gate が見るのは grant だけである。
//
// 拒否はすべて 404 not_found に揃える（存在オラクル対策）。「存在しない」と「権限が無い」を
// 撃ち分けると、対象の ID を総当たりするだけで中身を 1 バイトも読めないまま実在を数え上げ
// られる（このリポジトリは直近で似た撃ち分けの穴を 2 件塞いだところで、同じ穴を新設しない）。
// 対象の種類（ワークスペース/スペース/主体）にも理由（不在か無権限か）
// にもよらず 404 + {"error":"not_found"} に揃え、middleware.KnowledgeBaseWorkspace が
// 非メンバーへ返す応答と完全に一致させる。手順も「認可を先に、対象に触るのは後」を守り、
// 認可に落ちた要求は対象を一度も読まないので応答が対象の状態に依存しようがない。
// 引き換えに権限の無い相手には 403 という手掛かりも返らない。ページ CRUD 側は「閲覧できる
// 相手には実在を教えて良いので 403 を返す」としているが、権限操作は対象の ID を呼び出し側が
// 自由に指定できる（総当たりできる）ため、こちらは一律で閉じる。

// kbPermissionGate は権限操作 API の認可判定をまとめた入口。
// 各 handler はこれを埋め込んで使う（同じ判定を handler ごとに写経しないため）。
type kbPermissionGate struct {
	checkWorkspace *kb.CheckWorkspacePermissionUseCase
	checkSpace     *kb.CheckSpacePermissionUseCase
}

// newKbPermissionGate は権限操作 API 共通の認可判定を組み立てる。
func newKbPermissionGate(
	checkWorkspace *kb.CheckWorkspacePermissionUseCase,
	checkSpace *kb.CheckSpacePermissionUseCase,
) *kbPermissionGate {
	return &kbPermissionGate{checkWorkspace: checkWorkspace, checkSpace: checkSpace}
}

// respondKbPermissionDenied は権限操作 API の唯一の拒否応答。
//
// 拒否の理由（不在 / 無権限）でも対象の種類でも分けない。ここを 1 関数に閉じているのは、
// あとから「この場合だけ 403 にする」を足しにくくするため（足した瞬間に撃ち分けが復活する）。
func respondKbPermissionDenied(c *gin.Context) {
	c.JSON(http.StatusNotFound, errorResponse{Error: "not_found"})
}

// requireWorkspaceAdmin はワークスペース全体の admin かを確かめる（満たさなければ応答を
// 書いて false）。grant は配下の全スペースへ届くので、通る相手はテナント全体の管理者。
// スペースやページを指さない操作（メンバーの出入り・グループ・ワークスペース grant）が使う。
func (g *kbPermissionGate) requireWorkspaceAdmin(c *gin.Context, scope kbRequestScope) bool {
	perm, err := g.checkWorkspace.Execute(c.Request.Context(), kb.CheckWorkspacePermissionInput{
		WorkspaceID: scope.workspaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKbPermissionErr(c, err)
		return false
	}
	if !perm.CanManage {
		respondKbPermissionDenied(c)
		return false
	}
	return true
}

// requireSpaceAdmin はスペース 1 つの admin かを確かめる（満たさなければ応答を書いて false）。
// ワークスペースの admin もここを通る（workspace_grants は配下の全スペースへ届き、
// domain.GrantRole.Rank の合成規則で「最も強いもの」を採るためスペース単位の grant で
// 降格されない）。スペースが存在しない場合も無権限と同じ応答にする —
// CheckSpacePermissionUseCase は役割を集める前に実在を確かめて ErrSpaceNotFound を返すので、
// 他テナントのスペース ID を渡して自分の役割がそのまま返る、という緩み方はしない。
func (g *kbPermissionGate) requireSpaceAdmin(c *gin.Context, scope kbRequestScope, spaceID string) bool {
	perm, err := g.checkSpace.Execute(c.Request.Context(), kb.CheckSpacePermissionInput{
		WorkspaceID: scope.workspaceID,
		SpaceID:     spaceID,
		UserID:      scope.userID,
	})
	if err != nil {
		respondKbPermissionErr(c, err)
		return false
	}
	if !perm.CanManage {
		respondKbPermissionDenied(c)
		return false
	}
	return true
}

// respondKbPermissionErr は認可判定の途中で起きたエラーを応答へ落とす。対象が見つからない
// センチネルは拒否と同じ 404 not_found、それ以外（DB 障害など）だけ 500 にする。
// respondKnowledgeBaseErr を使わないのは、あちらが理由ごとの撃ち分け（403 等）を持つため —
// 権限操作 API はその撃ち分けを持たない。
func respondKbPermissionErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, repository.ErrWorkspaceNotFound),
		errors.Is(err, repository.ErrSpaceNotFound),
		errors.Is(err, repository.ErrPageNotFound),
		errors.Is(err, repository.ErrPrincipalNotFound),
		errors.Is(err, repository.ErrUserNotFound):
		respondKbPermissionDenied(c)
	default:
		c.JSON(http.StatusInternalServerError, errorResponse{Error: "internal_error"})
	}
}

// respondKbPermissionOperationErr は認可を通ったあとの操作で起きたエラーを応答へ落とす。
// ここまで来た相手は admin なので入力の誤り（未知の役割・グループ名重複・主体の種類違い）は
// 理由を返してよい。「対象が無い」はここでも 404 not_found のままにし、応答の集合を増やさない。
func respondKbPermissionOperationErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, kb.ErrInvalidGrantRole),
		errors.Is(err, kb.ErrPrincipalKindMismatch):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "invalid_request"})
	case errors.Is(err, repository.ErrPrincipalGroupNameTaken):
		c.JSON(http.StatusConflict, errorResponse{Error: "group_name_taken"})
	case errors.Is(err, user.ErrCannotSuspendSelf):
		c.JSON(http.StatusBadRequest, errorResponse{Error: "cannot_suspend_self"})
	case errors.Is(err, user.ErrTargetNotWorkspaceMember):
		// 対象の実在は確認済みだが、このワークスペースのメンバーでない相手には
		// respondKbPermissionDenied と同じ 404 で揃える（実在有無で権限境界を撃ち分けない）。
		respondKbPermissionDenied(c)
	case errors.Is(err, repository.ErrLastWorkspaceAdmin):
		// requireNotLastWorkspaceAdmin の手前の検査を競合がすり抜けて repository が
		// 最後に断ったときだけここへ来る。同じ 409 に落とし、区別が付かないようにする。
		c.JSON(http.StatusConflict, errorResponse{Error: "last_workspace_admin"})
	default:
		respondKbPermissionErr(c, err)
	}
}
