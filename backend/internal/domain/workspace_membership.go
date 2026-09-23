package domain

// MembershipStatus はワークスペース所属のライフサイクル状態（workspace_members.status）。
//
// スキーマの正本は schema.hcl の table "workspace_members" のコメント（procedural invariant
// を含む）を参照。
type MembershipStatus string

const (
	// MembershipStatusInvited は旧経路（users.id を指定する招待）が作っていた「招いたが本人が
	// まだ受諾していない」状態。いまの招待は invitations 表で持ち、承諾するまで workspace_members に
	// 行を作らないので、新しく書き込まれることは無い（既存の行は残りうる。CHECK の値も残す）。
	MembershipStatusInvited MembershipStatus = "invited"
	// MembershipStatusActive は実際のメンバー。principals(kind='user') の対応する行がある。
	MembershipStatusActive MembershipStatus = "active"
	// MembershipStatusSuspended は運営判断で一時的に外した状態（今の usecase はまだ
	// 書き込まない。将来の管理操作のための予約）。
	MembershipStatusSuspended MembershipStatus = "suspended"
	// MembershipStatusLeft は離脱・招待の辞退・削除。行は消さず記録として残す。
	MembershipStatusLeft MembershipStatus = "left"
)
