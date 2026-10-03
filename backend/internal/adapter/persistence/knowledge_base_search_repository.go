package persistence

import (
	"context"
	"encoding/json"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// pageSearchTextNodeType / pageSearchPageRefNodeType は inline JSON 内のノード type 名。
// usecase/kb の kbInlineTextNodeType / kbPageRefNodeType と同じ値だが、このパッケージからは
// import できない（依存方向の制約）ため独立して持つ。
const (
	pageSearchTextNodeType       = "text"
	pageSearchPageRefNodeType    = "pageRef"
	pageSearchTicketRefNodeType  = "ticketRef"
	pageSearchInlineMathNodeType = "inlineMath"
)

// pageSearchInlineNode は inline 配列の 1 要素を最小限に読むための型。
// usecase/kb.kbInlineTextNode と同じ形。
type pageSearchInlineNode struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Attrs struct {
		PageID   string `json:"pageId"`
		TicketID string `json:"ticketId"`
		Latex    string `json:"latex"`
	} `json:"attrs"`
}

// writePageSearchAndLinks は page_search の UPSERT と page_links の張り替えを行う。
// ReplacePageBlocks（本文保存）と RebuildPageSearchAndLinks（再構築）の両方が呼ぶ共有の
// 書き込みロジック。呼び出し元は同じトランザクションの qtx を渡すこと。
//
// 抽出（doc / blocks から body・pageLinks を作る部分）はここでは行わない。呼び出し元が
// 用意した値をそのまま書き込むだけ — ReplacePageBlocks は保存直前の ProseMirror doc から、
// RebuildPageSearchAndLinks は extractPageSearchFromBlocks が既存の blocks 行から抽出する。
func writePageSearchAndLinks(
	ctx context.Context, qtx *sqlcgen.Queries, wsID, pgID uuid.UUID, title, body string,
	pageLinks []repository.PageLinkWrite, pageTicketLinks []repository.PageTicketLinkWrite,
) error {
	// 1. page_search を焼き直す。
	if err := qtx.UpsertPageSearch(ctx, sqlcgen.UpsertPageSearchParams{
		PageID:      pgID,
		WorkspaceID: wsID,
		Title:       title,
		Body:        body,
	}); err != nil {
		return err
	}

	// 2. page_links を張り替える（前半: このページのブロックが持っていたリンクを全消し）。
	if err := qtx.DeletePageLinksBySourceBlockIDsInPage(ctx, sqlcgen.DeletePageLinksBySourceBlockIDsInPageParams{
		WorkspaceID: wsID,
		PageID:      pgID,
	}); err != nil {
		return err
	}
	if err := writePageLinks(ctx, qtx, pageLinks); err != nil {
		return err
	}

	// 3. page_ticket_links を張り替える（段 5。page_links と同じ前半・後半の形）。
	if err := qtx.DeletePageTicketLinksBySourceBlockIDsInPage(ctx, sqlcgen.DeletePageTicketLinksBySourceBlockIDsInPageParams{
		WorkspaceID: wsID,
		PageID:      pgID,
	}); err != nil {
		return err
	}
	return writePageTicketLinks(ctx, qtx, pageTicketLinks)
}

// writePageLinks は page_links の張り替え（後半）— 参照先が実在するものだけに絞って INSERT
// する（target_page_id は pages への FK なので、存在しない ID のまま INSERT すると外部キー
// 違反で保存全体が落ちる。リンク切れは黙って除外する）。呼び出し元が前半
// （DeletePageLinksBySourceBlockIDsInPage）を先に済ませること。
func writePageLinks(ctx context.Context, qtx *sqlcgen.Queries, pageLinks []repository.PageLinkWrite) error {
	if len(pageLinks) == 0 {
		return nil
	}
	targetSet := make(map[uuid.UUID]struct{}, len(pageLinks))
	targetIDs := make([]uuid.UUID, 0, len(pageLinks))
	for _, l := range pageLinks {
		id, err := uuid.Parse(l.TargetPageID)
		if err != nil {
			// usecase 側（extractPageLinks）は canonicalPageRefID で正規化済みの値しか
			// 積まないが、念のため壊れた値は保存全体を落とさず読み飛ばす。
			continue
		}
		if _, dup := targetSet[id]; dup {
			continue
		}
		targetSet[id] = struct{}{}
		targetIDs = append(targetIDs, id)
	}
	if len(targetIDs) == 0 {
		return nil
	}
	idsJSON, err := json.Marshal(targetIDs)
	if err != nil {
		return err
	}
	existingRows, err := qtx.ListExistingPageIDsAmong(ctx, idsJSON)
	if err != nil {
		return err
	}
	existing := make(map[uuid.UUID]struct{}, len(existingRows))
	for _, id := range existingRows {
		existing[id] = struct{}{}
	}

	// 実在確認済みの参照先ごとに INSERT する。1 つのブロックが同じページを複数回参照する
	// 場合は InsertPageLink の ON CONFLICT DO NOTHING で 1 行に畳まれる。
	for _, l := range pageLinks {
		tgtID, err := uuid.Parse(l.TargetPageID)
		if err != nil {
			continue
		}
		if _, ok := existing[tgtID]; !ok {
			continue
		}
		srcID, err := uuid.Parse(l.SourceBlockID)
		if err != nil {
			continue
		}
		if err := qtx.InsertPageLink(ctx, sqlcgen.InsertPageLinkParams{
			SourceBlockID: srcID,
			TargetPageID:  tgtID,
		}); err != nil {
			return err
		}
	}
	return nil
}

// writePageTicketLinks は page_ticket_links の張り替え（後半）。writePageLinks のチケット版
// （段 5）。呼び出し元が前半（DeletePageTicketLinksBySourceBlockIDsInPage）を先に済ませること。
func writePageTicketLinks(ctx context.Context, qtx *sqlcgen.Queries, pageTicketLinks []repository.PageTicketLinkWrite) error {
	if len(pageTicketLinks) == 0 {
		return nil
	}
	targetSet := make(map[uuid.UUID]struct{}, len(pageTicketLinks))
	targetIDs := make([]uuid.UUID, 0, len(pageTicketLinks))
	for _, l := range pageTicketLinks {
		id, err := uuid.Parse(l.TargetTicketID)
		if err != nil {
			continue
		}
		if _, dup := targetSet[id]; dup {
			continue
		}
		targetSet[id] = struct{}{}
		targetIDs = append(targetIDs, id)
	}
	if len(targetIDs) == 0 {
		return nil
	}
	idsJSON, err := json.Marshal(targetIDs)
	if err != nil {
		return err
	}
	existingRows, err := qtx.ListExistingTicketIDsAmong(ctx, idsJSON)
	if err != nil {
		return err
	}
	existing := make(map[uuid.UUID]struct{}, len(existingRows))
	for _, id := range existingRows {
		existing[id] = struct{}{}
	}

	for _, l := range pageTicketLinks {
		tgtID, err := uuid.Parse(l.TargetTicketID)
		if err != nil {
			continue
		}
		if _, ok := existing[tgtID]; !ok {
			continue
		}
		srcID, err := uuid.Parse(l.SourceBlockID)
		if err != nil {
			continue
		}
		if err := qtx.InsertPageTicketLink(ctx, sqlcgen.InsertPageTicketLinkParams{
			SourceBlockID:  srcID,
			TargetTicketID: tgtID,
		}); err != nil {
			return err
		}
	}
	return nil
}

// RebuildPageSearchAndLinks は既存ページ 1 件の page_search / page_links を、現在の
// blocks から作り直す（repository.KnowledgeBaseRepository の doc 参照）。
// DELETE + UPSERT で書き直すため、同じページに何度呼んでも結果は同じ（冪等）。
func (r *knowledgeBaseRepository) RebuildPageSearchAndLinks(ctx context.Context, workspaceID, pageID string) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return repository.ErrPageNotFound
	}
	return r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		page, err := findPageWith(ctx, qtx, workspaceID, pageID)
		if err != nil {
			return err
		}
		rows, err := qtx.ListBlocksByPage(ctx, sqlcgen.ListBlocksByPageParams{WorkspaceID: wsID, PageID: pgID})
		if err != nil {
			return err
		}
		blocks := make([]domain.Block, 0, len(rows))
		for _, row := range rows {
			blocks = append(blocks, toDomainBlock(row))
		}
		body, links, ticketLinks := extractPageSearchFromBlocks(blocks)
		return writePageSearchAndLinks(ctx, qtx, wsID, pgID, page.Title, body, links, ticketLinks)
	})
}

// orderedBlockNode は domain.Block 行を「文書順に近い」木として歩くための最小限の
// 中間表現。usecase/kb.kbDocNode と同じ役割だが、extractPageSearchFromBlocks が必要と
// するフィールド（id / inline / children）だけに絞ってある。
type orderedBlockNode struct {
	id       string
	typ      domain.BlockType
	attrs    string
	inline   *string
	children []*orderedBlockNode
}

// buildOrderedBlockForest は blocks 行を parent_id / position から木へ組み直す
// （usecase/kb.treeFromBlocks と同じ考え方の独立した再実装）。repository（このパッケージ）は
// クリーンアーキテクチャの依存方向（handler → usecase → repository/infra → domain）上
// usecase/kb を import できないため、抽出ロジックが 2 箇所に分かれるのを承知で書き直す。
//
// 壊れた親参照（存在しない parent_id）は無視する。treeFromBlocks（表示経路）は同じ状況を
// エラーにするが、こちらは検索キャッシュの再構築という補助的な経路なので、壊れた行が
// あってもそこだけ本文から漏れるに留め、再構築全体は失敗させない。
func buildOrderedBlockForest(blocks []domain.Block) []*orderedBlockNode {
	nodes := make(map[string]*orderedBlockNode, len(blocks))
	order := make(map[string]string, len(blocks))
	for _, b := range blocks {
		nodes[b.ID] = &orderedBlockNode{id: b.ID, typ: b.Type, attrs: b.Attrs, inline: b.Inline}
		order[b.ID] = b.Position
	}
	rootIDs := make([]string, 0)
	childIDs := make(map[string][]string, len(blocks))
	for _, b := range blocks {
		if b.ParentID == nil {
			rootIDs = append(rootIDs, b.ID)
			continue
		}
		if _, ok := nodes[*b.ParentID]; !ok {
			continue
		}
		childIDs[*b.ParentID] = append(childIDs[*b.ParentID], b.ID)
	}
	sortByPosition := func(ids []string) {
		sort.SliceStable(ids, func(i, j int) bool { return order[ids[i]] < order[ids[j]] })
	}
	sortByPosition(rootIDs)
	for _, ids := range childIDs {
		sortByPosition(ids)
	}
	for pid, ids := range childIDs {
		for _, id := range ids {
			nodes[pid].children = append(nodes[pid].children, nodes[id])
		}
	}
	roots := make([]*orderedBlockNode, 0, len(rootIDs))
	for _, id := range rootIDs {
		roots = append(roots, nodes[id])
	}
	return roots
}

// extractPageSearchFromBlocks は保存済みの blocks 行から body（本文プレーンテキスト）と
// pageLinks（page_links の材料）・pageTicketLinks（page_ticket_links の材料）を組み立てる。
// RebuildPageSearchAndLinks が使う。usecase/kb.extractPageBodyText 等と同じ考え方を、
// buildOrderedBlockForest の doc に書いた依存方向の理由でこのパッケージに閉じて実装している。
//
// pageSearchMaxDistinctTargets は参照先の種類数の天井（pageRef / ticketRef 別々に数える）。
// usecase/kb.kbPageRefMaxResolve と同じ値（100）を、import できないため独立して持つ —
// 保存経路と再構築経路で同じページの page_links / page_ticket_links が食い違わないよう揃える。
const pageSearchMaxDistinctTargets = 100

func extractPageSearchFromBlocks(
	blocks []domain.Block,
) (body string, pageLinks []repository.PageLinkWrite, pageTicketLinks []repository.PageTicketLinkWrite) {
	roots := buildOrderedBlockForest(blocks)
	var textBuf strings.Builder
	seenTarget := map[string]struct{}{}
	seenTicketTarget := map[string]struct{}{}
	var walk func(nodes []*orderedBlockNode)
	walk = func(nodes []*orderedBlockNode) {
		for _, n := range nodes {
			if len(n.children) > 0 {
				walk(n.children)
				continue
			}
			// 行の数式は中身を持たないので attrs.latex を 1 行として出す（usecase/kb.leafSearchText と同じ規則）。
			if n.typ == domain.BlockTypeBlockMath {
				var attrs struct {
					Latex string `json:"latex"`
				}
				if json.Unmarshal([]byte(n.attrs), &attrs) == nil && attrs.Latex != "" {
					if textBuf.Len() > 0 {
						textBuf.WriteByte('\n')
					}
					textBuf.WriteString(attrs.Latex)
				}
				continue
			}
			if n.inline == nil {
				continue
			}
			var items []pageSearchInlineNode
			if err := json.Unmarshal([]byte(*n.inline), &items); err != nil {
				continue
			}
			var blockText strings.Builder
			for _, it := range items {
				switch it.Type {
				case pageSearchTextNodeType:
					blockText.WriteString(it.Text)
				case pageSearchInlineMathNodeType:
					blockText.WriteString(it.Attrs.Latex)
				case pageSearchPageRefNodeType:
					id, err := uuid.Parse(it.Attrs.PageID)
					if err != nil {
						continue
					}
					target := id.String()
					if _, known := seenTarget[target]; !known {
						if len(seenTarget) >= pageSearchMaxDistinctTargets {
							continue
						}
						seenTarget[target] = struct{}{}
					}
					pageLinks = append(pageLinks, repository.PageLinkWrite{
						SourceBlockID: n.id,
						TargetPageID:  target,
					})
				case pageSearchTicketRefNodeType:
					id, err := uuid.Parse(it.Attrs.TicketID)
					if err != nil {
						continue
					}
					target := id.String()
					if _, known := seenTicketTarget[target]; !known {
						if len(seenTicketTarget) >= pageSearchMaxDistinctTargets {
							continue
						}
						seenTicketTarget[target] = struct{}{}
					}
					pageTicketLinks = append(pageTicketLinks, repository.PageTicketLinkWrite{
						SourceBlockID:  n.id,
						TargetTicketID: target,
					})
				}
			}
			if blockText.Len() > 0 {
				if textBuf.Len() > 0 {
					textBuf.WriteByte('\n')
				}
				textBuf.WriteString(blockText.String())
			}
		}
	}
	walk(roots)
	return textBuf.String(), pageLinks, pageTicketLinks
}
