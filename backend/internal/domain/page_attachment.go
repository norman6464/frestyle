package domain

import "time"

// PageAttachment はナレッジのページ本文に置いた添付ファイル 1 件のメタデータ。本体は
// Cloud Storage（Key で指す）。本文の attachment ノードは ID だけを持ち、Filename・SizeBytes・
// ContentType は本文の保存時にこの値から attrs へ写す（後から変わらないので写しが古くならない）。
//
// 種類と大きさの許可は ValidateAttachmentUpload、ファイル名の形は ValidateAttachmentFilename を
// チケット添付と共用する（受け付ける範囲を 2 つの入口で食い違わせない）。
type PageAttachment struct {
	ID          string
	WorkspaceID string
	PageID      string
	// Key は保管庫の名前。応答にも本文にも出さない（URL の発行だけに使う）。
	Key              string `json:"-"`
	Filename         string
	ContentType      string
	SizeBytes        int64
	UploadedByUserID uint64
	CreatedAt        time.Time
}
