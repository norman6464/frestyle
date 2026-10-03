package kb

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

var (
	// ErrInvalidPageAttachmentKey は、そのページの添付の接頭辞（kb/<workspaceId>/<pageId>/att/）を
	// 持たない key で記録しようとしたときに返す。key はアップロード URL の発行時にサーバーが採番する。
	// この検査が無いと、他ページ・他テナントの実在する key を知る人が自分の編集できるページの添付
	// として記録し、ダウンロード URL の発行経由でそのファイルを読み出せてしまう。
	ErrInvalidPageAttachmentKey = errors.New("invalid page attachment key")
	// ErrPageDocUnknownAttachment は、本文の attachment ノードが「このページの添付」ではない ID を
	// 指しているときに返す（別ページ・別ワークスペース・存在しない）。
	ErrPageDocUnknownAttachment = errors.New("page doc refers to an attachment that does not belong to the page")
)

// pageAttachmentKeyPrefix はページ 1 枚に閉じた添付の key の接頭辞（"kb/<workspaceId>/<pageId>/att/"）。
// 画像（kbImageKeyPrefix）の下に att/ を切るので、画像の key として記録することはできない
// （画像の key は att/ を持たない）。
func pageAttachmentKeyPrefix(workspaceID, pageID string) string {
	return kbImageKeyPrefix(workspaceID, pageID) + "att/"
}

// IssuePageAttachmentUploadURLUseCase はページに閉じた添付ファイルの PUT presigned URL を発行する。
// key は "kb/<workspaceId>/<pageId>/att/<epochNs>.bin" の形で採番する。
type IssuePageAttachmentUploadURLUseCase struct {
	pages     repository.KnowledgeBaseRepository
	presigner repository.PageAttachmentPresigner
}

func NewIssuePageAttachmentUploadURLUseCase(
	pages repository.KnowledgeBaseRepository, presigner repository.PageAttachmentPresigner,
) *IssuePageAttachmentUploadURLUseCase {
	return &IssuePageAttachmentUploadURLUseCase{pages: pages, presigner: presigner}
}

type IssuePageAttachmentUploadURLInput struct {
	WorkspaceID string
	PageID      string
	ContentType string
	Size        int64
}

type IssuePageAttachmentUploadURLOutput struct {
	URL       string
	Key       string
	ExpiresIn int
}

func (u *IssuePageAttachmentUploadURLUseCase) Execute(
	ctx context.Context, in IssuePageAttachmentUploadURLInput,
) (*IssuePageAttachmentUploadURLOutput, error) {
	// 形の検証は repository を呼ぶ前に済ませる（IssuePageImageUploadURLUseCase と同じ）。
	if err := domain.ValidateAttachmentUpload(in.ContentType, in.Size); err != nil {
		return nil, err
	}
	page, err := u.pages.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	key := fmt.Sprintf("%s%d.bin", pageAttachmentKeyPrefix(in.WorkspaceID, in.PageID), time.Now().UnixNano())
	url, expiresIn, err := u.presigner.PresignUpload(ctx, key, in.ContentType, in.Size)
	if err != nil {
		return nil, err
	}
	return &IssuePageAttachmentUploadURLOutput{URL: url, Key: key, ExpiresIn: expiresIn}, nil
}

// CreatePageAttachmentUseCase は presigned URL への PUT が終わったあとに添付のメタデータを記録する。
// アップロード本体は見ないので Content-Type・大きさは自己申告の再検証にとどまる（実データとの
// 一致は、PUT の時点で GCS の署名検証が Content-Type と Content-Length を突き合わせて担う）。
type CreatePageAttachmentUseCase struct {
	pages       repository.KnowledgeBaseRepository
	attachments repository.PageAttachmentRepository
}

func NewCreatePageAttachmentUseCase(
	pages repository.KnowledgeBaseRepository, attachments repository.PageAttachmentRepository,
) *CreatePageAttachmentUseCase {
	return &CreatePageAttachmentUseCase{pages: pages, attachments: attachments}
}

type CreatePageAttachmentInput struct {
	WorkspaceID      string
	PageID           string
	Key              string
	Filename         string
	ContentType      string
	SizeBytes        int64
	UploadedByUserID uint64
}

func (u *CreatePageAttachmentUseCase) Execute(ctx context.Context, in CreatePageAttachmentInput) (*domain.PageAttachment, error) {
	if err := domain.ValidateAttachmentUpload(in.ContentType, in.SizeBytes); err != nil {
		return nil, err
	}
	if err := domain.ValidateAttachmentFilename(in.Filename); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(in.Key, pageAttachmentKeyPrefix(in.WorkspaceID, in.PageID)) {
		return nil, ErrInvalidPageAttachmentKey
	}
	page, err := u.pages.FindPage(ctx, in.WorkspaceID, in.PageID)
	if err != nil {
		return nil, err
	}
	if page.ArchivedAt != nil {
		return nil, ErrPageArchived
	}
	a := &domain.PageAttachment{
		WorkspaceID: in.WorkspaceID, PageID: in.PageID, Key: in.Key, Filename: in.Filename,
		ContentType: in.ContentType, SizeBytes: in.SizeBytes, UploadedByUserID: in.UploadedByUserID,
	}
	if err := u.attachments.CreatePageAttachment(ctx, a); err != nil {
		return nil, err
	}
	return a, nil
}

// IssuePageAttachmentDownloadURLUseCase は添付の GET presigned URL を、元のファイル名で保存させる
// 指定つきで発行する。FindPageAttachment が (workspace_id, page_id, id) で絞るので、見つかった時点で
// このページの添付だと確定する（ページ画像のような key の接頭辞の照合は要らない）。認可（このページを
// 閲覧できるか）は handler が済ませている前提。
type IssuePageAttachmentDownloadURLUseCase struct {
	attachments repository.PageAttachmentRepository
	presigner   repository.PageAttachmentPresigner
}

func NewIssuePageAttachmentDownloadURLUseCase(
	attachments repository.PageAttachmentRepository, presigner repository.PageAttachmentPresigner,
) *IssuePageAttachmentDownloadURLUseCase {
	return &IssuePageAttachmentDownloadURLUseCase{attachments: attachments, presigner: presigner}
}

type IssuePageAttachmentDownloadURLInput struct {
	WorkspaceID  string
	PageID       string
	AttachmentID string
}

type IssuePageAttachmentDownloadURLOutput struct {
	URL       string
	ExpiresIn int
}

func (u *IssuePageAttachmentDownloadURLUseCase) Execute(
	ctx context.Context, in IssuePageAttachmentDownloadURLInput,
) (*IssuePageAttachmentDownloadURLOutput, error) {
	a, err := u.attachments.FindPageAttachment(ctx, in.WorkspaceID, in.PageID, in.AttachmentID)
	if err != nil {
		return nil, err
	}
	url, expiresIn, err := u.presigner.PresignDownload(ctx, a.Key, a.Filename)
	if err != nil {
		return nil, err
	}
	return &IssuePageAttachmentDownloadURLOutput{URL: url, ExpiresIn: expiresIn}, nil
}

// normalizeAttachmentAttrs は attachment ノードの attrs を検査し、attachmentId（UUID の正規形）
// だけを残す。filename・size・contentType・pageId はクライアントの値を信じず、保存時に
// bindPageAttachments が添付の行から書き直す（書いた人が別の名前を見せかけるのを防ぐ。
// 提案の差分にもファイル名が出るので、コメント権限の人が名前を偽ると承認する人を欺ける）。
func normalizeAttachmentAttrs(m map[string]json.RawMessage) error {
	var id *string
	raw, ok := m["attachmentId"]
	if !ok || json.Unmarshal(raw, &id) != nil || id == nil {
		return fmt.Errorf("%w: 添付の attachmentId が文字列ではありません", ErrPageDocInvalid)
	}
	parsed, err := uuid.Parse(*id)
	if err != nil {
		return fmt.Errorf("%w: 添付の attachmentId が UUID ではありません", ErrPageDocInvalid)
	}
	for k := range m {
		delete(m, k)
	}
	encoded, err := json.Marshal(parsed.String())
	if err != nil {
		return fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
	}
	m["attachmentId"] = encoded
	return nil
}

// pageAttachmentAttrs は保存する attachment ノードの attrs。表示に要る値はすべて添付の行から写す
// （行は後から変わらないので写しが古くならない。ページを読める人なら添付の名前も読んでよい）。
// pageId は画面が「別のページから貼り付けた添付」を見分けるために持つ（そのまま保存すると
// このページの添付ではないので保存が断られる）。
type pageAttachmentAttrs struct {
	AttachmentID string `json:"attachmentId"`
	PageID       string `json:"pageId"`
	Filename     string `json:"filename"`
	ContentType  string `json:"contentType"`
	Size         int64  `json:"size"`
}

// bindPageAttachments は本文の木の attachment ノードを、このページの添付の行と突き合わせる。
// どれか 1 つでもこのページの添付でなければ ErrPageDocUnknownAttachment を返す（黙って消すと、
// 書いた人に気づかれないまま添付が本文から消える。画像の src を断るのと同じ判断）。通れば
// 各ノードの attrs を行の値で書き直す。attachment ノードが無ければ問い合わせない。
//
// 添付の行は消えない（削除の経路が無く、ページごと消えるときだけ CASCADE で消える）ので、
// 突き合わせは本文を書き込むトランザクションの外でよい。
func bindPageAttachments(
	ctx context.Context, attachments repository.PageAttachmentRepository, workspaceID, pageID string, nodes []*kbDocNode,
) error {
	var targets []*kbDocNode
	var walk func(ns []*kbDocNode)
	walk = func(ns []*kbDocNode) {
		for _, n := range ns {
			if n.Type == domain.BlockTypeAttachment {
				targets = append(targets, n)
			}
			walk(n.Children)
		}
	}
	walk(nodes)
	if len(targets) == 0 {
		return nil
	}

	ids := make([]string, 0, len(targets))
	nodeIDs := make([]string, len(targets))
	seen := make(map[string]struct{}, len(targets))
	for i, n := range targets {
		var attrs struct {
			AttachmentID string `json:"attachmentId"`
		}
		// attrs は normalizeAttachmentAttrs が {attachmentId: 正規形の UUID} にそろえ済み。
		if err := json.Unmarshal([]byte(n.Attrs), &attrs); err != nil {
			return fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
		}
		nodeIDs[i] = attrs.AttachmentID
		if _, ok := seen[attrs.AttachmentID]; !ok {
			seen[attrs.AttachmentID] = struct{}{}
			ids = append(ids, attrs.AttachmentID)
		}
	}
	rows, err := attachments.ListPageAttachmentsByIDs(ctx, workspaceID, pageID, ids)
	if err != nil {
		return err
	}
	byID := make(map[string]domain.PageAttachment, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	for i, n := range targets {
		row, ok := byID[nodeIDs[i]]
		if !ok {
			return fmt.Errorf("%w: %s", ErrPageDocUnknownAttachment, nodeIDs[i])
		}
		encoded, err := json.Marshal(pageAttachmentAttrs{
			AttachmentID: row.ID, PageID: row.PageID, Filename: row.Filename,
			ContentType: row.ContentType, Size: row.SizeBytes,
		})
		if err != nil {
			return fmt.Errorf("%w: %w", ErrPageDocInvalid, err)
		}
		n.Attrs = string(encoded)
	}
	return nil
}
