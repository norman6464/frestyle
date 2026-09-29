package domain

// Capability はページに対してできることの単位（閲覧 / 編集）。実効権限の Allows が受け取る。
//
// コメント（GrantRole.CanComment）はここには入れない。コメントできるかは役割の写像で決まり、
// ケイパビリティとして外から渡す場面が無いため。保存する値ではないので、検証用の一覧も持たない。
type Capability string

const (
	// CapabilityView はページを閲覧できること。
	CapabilityView Capability = "view"
	// CapabilityEdit はページを編集できること。編集できる者は必ず閲覧もできる
	// （ResolvePagePermission が edit に view を含める）。
	CapabilityEdit Capability = "edit"
)
