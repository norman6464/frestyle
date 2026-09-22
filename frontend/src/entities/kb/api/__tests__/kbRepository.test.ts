import { describe, it, expect, vi, beforeEach } from 'vitest';
import KbRepository from '../kbRepository';
import apiClient from '@/shared/api/axios';
import axios from 'axios';

vi.mock('@/shared/api/axios');
// S3 への直接 PUT は apiClient ではなく素の axios を使う（entities/user/imageUploadRepository と同じ形）。
// put だけ差し替える — @/shared/api/axios.ts 自身が axios.create を実体で呼ぶため、
// create ごと潰すとその読み込み自体が壊れる。
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  actual.default.put = vi.fn();
  return actual;
});

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);
const mockAxiosPut = vi.mocked(axios.put);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KbRepository', () => {
  it('fetchRecentPages は自分の最近見たページを取得し、null は空配列にする', async () => {
    const controller = new AbortController();
    mockGet.mockResolvedValueOnce({ data: [{ pageId: 'p1', title: '設計メモ' }] });

    await expect(KbRepository.fetchRecentPages(controller.signal)).resolves.toEqual([
      { pageId: 'p1', title: '設計メモ' },
    ]);
    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/me/recent-pages', {
      signal: controller.signal,
    });

    mockGet.mockResolvedValueOnce({ data: null });
    await expect(KbRepository.fetchRecentPages()).resolves.toEqual([]);
  });

  it('fetchWorkspaces は GET /kb/workspaces で配列を返す', async () => {
    mockGet.mockResolvedValue({ data: [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-08-01T00:00:00Z' }] });

    const list = await KbRepository.fetchWorkspaces();

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces');
    expect(list).toHaveLength(1);
  });

  it('fetchSpaces は slug を URL に埋める', async () => {
    mockGet.mockResolvedValue({ data: [] });

    await KbRepository.fetchSpaces('acme');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/spaces');
  });

  it('一覧が null で返っても空配列にする', async () => {
    // 0 件を null で返されると map / for-of が落ちて画面が開けなくなる。
    mockGet.mockResolvedValue({ data: null });

    await expect(KbRepository.fetchWorkspaces()).resolves.toEqual([]);
    await expect(KbRepository.fetchSpaces('acme')).resolves.toEqual([]);
  });

  it('fetchMembers は GET /kb/workspaces/:slug/members を叩き、裸の配列をそのまま返す', async () => {
    mockGet.mockResolvedValue({ data: [{ principalId: 'p-1', userId: 42, name: '田中 太郎' }] });

    const members = await KbRepository.fetchMembers('acme');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/members');
    expect(members).toEqual([{ principalId: 'p-1', userId: 42, name: '田中 太郎' }]);
  });

  it('fetchMembers も null 応答は空配列にする', async () => {
    mockGet.mockResolvedValue({ data: null });
    await expect(KbRepository.fetchMembers('acme')).resolves.toEqual([]);
  });

  describe('fetchPageTree', () => {
    it('slug と spaceId を URL に埋める', async () => {
      mockGet.mockResolvedValue({ data: { pages: [], hasHiddenChildren: false } });

      await KbRepository.fetchPageTree('acme', 'space-1');

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/spaces/space-1/pages', {
        params: undefined,
      });
    });

    it('archived を渡すとスコープを切り替える（別の口ではなく同じ口）', async () => {
      mockGet.mockResolvedValue({ data: { pages: [], hasHiddenChildren: false } });

      await KbRepository.fetchPageTree('acme', 's1', { archived: true });

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/spaces/s1/pages', {
        params: { archived: 'true' },
      });
    });

    it('hasHiddenChildren をそのまま通す', async () => {
      mockGet.mockResolvedValue({ data: { pages: [], hasHiddenChildren: true } });

      await expect(KbRepository.fetchPageTree('acme', 's1')).resolves.toEqual({
        pages: [],
        hasHiddenChildren: true,
      });
    });

    it.each([
      ['項目が無い', { pages: [] }],
      ['null', { pages: [], hasHiddenChildren: null }],
      ['応答そのものが空', undefined],
    ])('hasHiddenChildren が %s なら false に倒す', async (_label, data) => {
      // 倒す向きが逆だと、印が出るはずのない場面で「表示できないページがあります」が出る。
      mockGet.mockResolvedValue({ data });

      const tree = await KbRepository.fetchPageTree('acme', 's1');

      expect(tree.hasHiddenChildren).toBe(false);
    });

    it('pages が欠けていても空配列にする', async () => {
      mockGet.mockResolvedValue({ data: { hasHiddenChildren: false } });

      await expect(KbRepository.fetchPageTree('acme', 's1')).resolves.toEqual({
        pages: [],
        hasHiddenChildren: false,
      });
    });
  });

  describe('createPage', () => {
    it('parentId を省くと空文字で送る（backend は空文字を「親なし」として扱う）', async () => {
      mockPost.mockResolvedValue({ data: { id: 'new-1' } });

      await KbRepository.createPage('acme', 's1', { title: '無題' });

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/spaces/s1/pages', {
        title: '無題',
        parentId: '',
      });
    });

    it('parentId を渡すとそのまま送る', async () => {
      mockPost.mockResolvedValue({ data: { id: 'new-1' } });

      await KbRepository.createPage('acme', 's1', { title: '無題', parentId: 'p1' });

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/spaces/s1/pages', {
        title: '無題',
        parentId: 'p1',
      });
    });

    it('失敗は握り潰さず投げる', async () => {
      // 握り潰して null や false を返すと、呼び出し側は失敗を知りようがない。
      // このリポジトリの「失敗したのに成功の表示」はどれもここが原因だった。
      mockPost.mockRejectedValue(new Error('boom'));

      await expect(
        KbRepository.createPage('acme', 's1', { title: '無題' }),
      ).rejects.toThrow();
    });
  });

  describe('renamePage', () => {
    it('PATCH で題名だけを送る', async () => {
      mockPatch.mockResolvedValue({ data: { id: 'p1', title: '新しい名前' } });

      await KbRepository.renamePage('acme', 'p1', '新しい名前');

      expect(mockPatch).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p1', {
        title: '新しい名前',
      });
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPatch.mockRejectedValue(new Error('boom'));

      await expect(KbRepository.renamePage('acme', 'p1', 'x')).rejects.toThrow();
    });
  });

  describe('archivePage / unarchivePage', () => {
    it('archivePage は POST /archive を叩く', async () => {
      mockPost.mockResolvedValue({ data: undefined });

      await KbRepository.archivePage('acme', 'p1');

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p1/archive');
    });

    it('unarchivePage は POST /unarchive を叩き、戻ったページを返す', async () => {
      mockPost.mockResolvedValue({ data: { id: 'p1', title: '戻った' } });

      const restored = await KbRepository.unarchivePage('acme', 'p1');

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p1/unarchive');
      expect(restored.title).toBe('戻った');
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('boom'));

      await expect(KbRepository.archivePage('acme', 'p1')).rejects.toThrow();
      await expect(KbRepository.unarchivePage('acme', 'p1')).rejects.toThrow();
    });
  });

  it('fetchPage は slug と pageId を URL に埋める', async () => {
    mockGet.mockResolvedValue({ data: { page: { id: 'p1' }, doc: { type: 'doc' } } });

    await KbRepository.fetchPage('acme', 'p1');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p1');
  });

  it('searchPages は GET /search に q を渡し、null 応答でも空配列にする', async () => {
    mockGet.mockResolvedValue({ data: null });

    await expect(KbRepository.searchPages('acme', 'docker')).resolves.toEqual([]);
    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/search', {
      params: { q: 'docker' },
    });
  });

  it('searchPages は limit を渡したときだけ params に載せる', async () => {
    mockGet.mockResolvedValue({ data: [] });

    await KbRepository.searchPages('acme', 'docker', 5);

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/search', {
      params: { q: 'docker', limit: 5 },
    });
  });

  describe('searchPages の一致情報（matchField / excerpt / matchStart / matchLen）', () => {
    it('題名一致の要素はそのまま通す（matchField 以外の追加フィールドは無い）', async () => {
      const hit = {
        id: 'p-1',
        spaceId: 's1',
        title: '設計メモ',
        createdByUserId: 1,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        matchField: 'title' as const,
      };
      mockGet.mockResolvedValue({ data: [hit] });

      const [got] = await KbRepository.searchPages('acme', '設計');

      expect(got).toEqual(hit);
    });

    it('本文一致の要素は excerpt / matchStart / matchLen を持ったまま通す', async () => {
      const hit = {
        id: 'p-2',
        spaceId: 's1',
        title: '無関係な題名',
        createdByUserId: 1,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        matchField: 'body' as const,
        excerpt: '…この段落には docker の使い方が書かれている…',
        matchStart: 8,
        matchLen: 6,
      };
      mockGet.mockResolvedValue({ data: [hit] });

      const [got] = await KbRepository.searchPages('acme', 'docker');

      expect(got).toEqual(hit);
      expect(got.excerpt).toBe('…この段落には docker の使い方が書かれている…');
      expect(got.matchStart).toBe(8);
      expect(got.matchLen).toBe(6);
    });

    it('旧応答（matchField 等が無い）でも画面が落ちない形でそのまま通す', async () => {
      const legacy = {
        id: 'p-3',
        spaceId: 's1',
        title: '旧仕様の結果',
        createdByUserId: 1,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      };
      mockGet.mockResolvedValue({ data: [legacy] });

      const [got] = await KbRepository.searchPages('acme', 'x');

      expect(got.matchField).toBeUndefined();
      expect(got.excerpt).toBeUndefined();
    });
  });

  describe('listBacklinks', () => {
    it('GET /pages/:id/backlinks を叩き、一覧を配列で返す', async () => {
      const page = {
        id: 'p-referrer',
        spaceId: 's1',
        title: '参照元ページ',
        createdByUserId: 1,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      };
      mockGet.mockResolvedValue({ data: [page] });

      const backlinks = await KbRepository.listBacklinks('acme', 'p-1');

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/backlinks');
      expect(backlinks).toEqual([page]);
    });

    it('一覧が null で返っても空配列にする', async () => {
      mockGet.mockResolvedValue({ data: null });

      await expect(KbRepository.listBacklinks('acme', 'p-1')).resolves.toEqual([]);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockGet.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.listBacklinks('acme', 'p-1')).rejects.toThrow();
    });
  });

  it('renameSpace は PATCH /spaces/:id に name だけを送る', async () => {
    mockPatch.mockResolvedValue({
      data: { id: 'sp-1', key: 'eng', name: '技術部', createdAt: '2026-08-01T00:00:00Z' },
    });

    const space = await KbRepository.renameSpace('acme', 'sp-1', '技術部');

    expect(mockPatch).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/spaces/sp-1', {
      name: '技術部',
    });
    expect(space.name).toBe('技術部');
  });

  it('renameSpace の失敗は投げる（握り潰すと成功の表示だけが残る）', async () => {
    mockPatch.mockRejectedValue(new Error('forbidden'));

    await expect(KbRepository.renameSpace('acme', 'sp-1', 'x')).rejects.toThrow();
  });

  it('resolvePage は GET /kb/pages/:id で解決結果をそのまま返す', async () => {
    const resolved = {
      workspaceSlug: 'w-3f2a9c',
      page: { id: 'p-1', spaceId: 'sp-1', title: '設計メモ' },
      doc: { type: 'doc', content: [] },
      canEdit: true,
    };
    mockGet.mockResolvedValue({ data: resolved });

    const got = await KbRepository.resolvePage('p-1');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/pages/p-1');
    expect(got).toEqual(resolved);
  });

  it('resolvePage の失敗は投げる（404 は「無い」と「見えない」の両方）', async () => {
    mockGet.mockRejectedValue(new Error('not found'));

    await expect(KbRepository.resolvePage('p-x')).rejects.toThrow();
  });

  it('replaceContent は PUT /pages/:id/content に { doc } を送り、正規形を返す', async () => {
    const normalized = { doc: { type: 'doc', content: [] }, builtAt: '2026-08-28T00:00:00Z' };
    mockPut.mockResolvedValue({ data: normalized });

    const got = await KbRepository.replaceContent('acme', 'p-1', {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });

    expect(mockPut).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/content', {
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    expect(got).toEqual(normalized);
  });

  it('replaceContent の失敗は投げる（呼び出し側が未保存へ戻すため）', async () => {
    mockPut.mockRejectedValue(new Error('conflict'));

    await expect(KbRepository.replaceContent('acme', 'p-1', {})).rejects.toThrow();
  });

  it('replaceContent は応答の lastEditedBy / lastEditedAt もそのまま返す', async () => {
    const withEditor = {
      doc: { type: 'doc', content: [] },
      builtAt: '2026-09-06T00:00:00Z',
      lastEditedBy: { userId: 1, name: '田中 太郎' },
      lastEditedAt: '2026-09-06T00:00:00Z',
    };
    mockPut.mockResolvedValue({ data: withEditor });

    const got = await KbRepository.replaceContent('acme', 'p-1', { type: 'doc', content: [] });

    expect(got.lastEditedBy).toEqual({ userId: 1, name: '田中 太郎' });
    expect(got.lastEditedAt).toBe('2026-09-06T00:00:00Z');
  });

  describe('setPageIcon', () => {
    it('PUT /pages/:id/icon に icon を送り、確定後のページを返す', async () => {
      const page = { id: 'p-1', icon: { type: 'emoji', value: '📘' } };
      mockPut.mockResolvedValue({ data: page });

      const got = await KbRepository.setPageIcon('acme', 'p-1', { type: 'emoji', value: '📘' });

      expect(mockPut).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/icon', {
        type: 'emoji',
        value: '📘',
      });
      expect(got).toEqual(page);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPut.mockRejectedValue(new Error('invalid_icon'));

      await expect(
        KbRepository.setPageIcon('acme', 'p-1', { type: 'emoji', value: '📘' }),
      ).rejects.toThrow();
    });
  });

  describe('clearPageIcon', () => {
    it('DELETE /pages/:id/icon を叩き、確定後のページを返す（204 ではなく 200 + ページ）', async () => {
      const page = { id: 'p-1', icon: null };
      mockDelete.mockResolvedValue({ data: page });

      const got = await KbRepository.clearPageIcon('acme', 'p-1');

      expect(mockDelete).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/icon');
      expect(got).toEqual(page);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockDelete.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.clearPageIcon('acme', 'p-1')).rejects.toThrow();
    });
  });

  describe('issuePageImageUploadURL', () => {
    it('POST /images/upload-url に contentType と size を送る', async () => {
      mockPost.mockResolvedValue({
        data: { url: 'https://s3/put?sig', key: 'kb/w-1/p-1/1.bin', expiresIn: 600 },
      });

      const got = await KbRepository.issuePageImageUploadURL('acme', 'p-1', 'image/png', 1234);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/images/upload-url',
        { contentType: 'image/png', size: 1234 },
      );
      expect(got).toEqual({ url: 'https://s3/put?sig', key: 'kb/w-1/p-1/1.bin', expiresIn: 600 });
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('boom'));

      await expect(
        KbRepository.issuePageImageUploadURL('acme', 'p-1', 'image/png', 1),
      ).rejects.toThrow();
    });
  });

  describe('issuePageImageDownloadURL', () => {
    it('GET /images/download-url に key を渡す（URL エンコードする）', async () => {
      mockGet.mockResolvedValue({ data: { url: 'https://s3/get?sig', expiresIn: 600 } });

      await KbRepository.issuePageImageDownloadURL('acme', 'p-1', 'kb/w-1/p-1/1.bin');

      expect(mockGet).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/images/download-url?key=kb%2Fw-1%2Fp-1%2F1.bin',
      );
    });

    it('存在しない/参照されていない key の 404 も含め、失敗は握り潰さず投げる', async () => {
      mockGet.mockRejectedValue(new Error('404'));

      await expect(
        KbRepository.issuePageImageDownloadURL('acme', 'p-1', 'kb/missing.bin'),
      ).rejects.toThrow();
    });
  });

  describe('uploadPageImage', () => {
    it('署名 URL を発行し、S3 へ直接 PUT して key を返す（publicUrl ではない）', async () => {
      mockPost.mockResolvedValue({
        data: { url: 'https://s3/put?sig', key: 'kb/w-1/p-1/1.bin', expiresIn: 600 },
      });
      mockAxiosPut.mockResolvedValue({});
      const file = new File(['x'], 'diagram.png', { type: 'image/png' });

      const key = await KbRepository.uploadPageImage('acme', 'p-1', file);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/images/upload-url',
        { contentType: 'image/png', size: file.size },
      );
      expect(mockAxiosPut).toHaveBeenCalledWith('https://s3/put?sig', file, {
        headers: { 'Content-Type': 'image/png' },
      });
      expect(key).toBe('kb/w-1/p-1/1.bin');
    });

    it('署名発行の失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('boom'));
      const file = new File(['x'], 'diagram.png', { type: 'image/png' });

      await expect(KbRepository.uploadPageImage('acme', 'p-1', file)).rejects.toThrow();
      expect(mockAxiosPut).not.toHaveBeenCalled();
    });

    it('S3 PUT の失敗は握り潰さず投げる', async () => {
      mockPost.mockResolvedValue({
        data: { url: 'https://s3/put?sig', key: 'kb/w-1/p-1/1.bin', expiresIn: 600 },
      });
      mockAxiosPut.mockRejectedValue(new Error('s3 down'));
      const file = new File(['x'], 'diagram.png', { type: 'image/png' });

      await expect(KbRepository.uploadPageImage('acme', 'p-1', file)).rejects.toThrow();
    });
  });

  describe('setPageCover', () => {
    it('PUT /cover に {type: "file", key} を送り、page と cover を返す', async () => {
      const body = { page: { id: 'p-1' }, cover: { type: 'file', url: 'https://cdn/cover.png' } };
      mockPut.mockResolvedValue({ data: body });

      const got = await KbRepository.setPageCover('acme', 'p-1', 'kb/w-1/p-1/1.bin');

      expect(mockPut).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/cover', {
        type: 'file',
        key: 'kb/w-1/p-1/1.bin',
      });
      expect(got).toEqual(body);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPut.mockRejectedValue(new Error('forbidden'));

      await expect(
        KbRepository.setPageCover('acme', 'p-1', 'kb/w-1/p-1/1.bin'),
      ).rejects.toThrow();
    });
  });

  describe('clearPageCover', () => {
    it('DELETE /cover を叩き、page と null の cover を返す', async () => {
      const body = { page: { id: 'p-1' }, cover: null };
      mockDelete.mockResolvedValue({ data: body });

      const got = await KbRepository.clearPageCover('acme', 'p-1');

      expect(mockDelete).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/cover');
      expect(got).toEqual(body);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockDelete.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.clearPageCover('acme', 'p-1')).rejects.toThrow();
    });
  });

  describe('listCommentThreads', () => {
    it('GET /comment-threads を叩き、threads を配列で返す', async () => {
      const thread = {
        id: 't-1',
        createdBy: { userId: 1, name: '田中 太郎' },
        resolvedAt: null,
        resolvedBy: null,
        createdAt: '2026-09-01T00:00:00Z',
        comments: [
          {
            id: 'c-1',
            author: { userId: 1, name: '田中 太郎' },
            body: [{ type: 'text', text: 'これはどういう意味ですか？' }],
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ],
      };
      mockGet.mockResolvedValue({ data: { threads: [thread] } });

      const threads = await KbRepository.listCommentThreads('acme', 'p-1');

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/comment-threads');
      expect(threads).toEqual([thread]);
    });

    it('threads が欠けた応答でも空配列にする', async () => {
      mockGet.mockResolvedValue({ data: {} });

      await expect(KbRepository.listCommentThreads('acme', 'p-1')).resolves.toEqual([]);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockGet.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.listCommentThreads('acme', 'p-1')).rejects.toThrow();
    });

    it('blockId/anchorFrom/anchorTo/quote を持つ応答（錨付きコメント）はそのまま通す', async () => {
      const anchoredThread = {
        id: 't-2',
        createdBy: { userId: 1, name: '田中 太郎' },
        resolvedAt: null,
        resolvedBy: null,
        createdAt: '2026-09-01T00:00:00Z',
        comments: [],
        blockId: 'block-1',
        anchorFrom: 3,
        anchorTo: 9,
        quote: '選んだ文',
      };
      mockGet.mockResolvedValue({ data: { threads: [anchoredThread] } });

      const [thread] = await KbRepository.listCommentThreads('acme', 'p-1');

      expect(thread).toMatchObject({
        blockId: 'block-1',
        anchorFrom: 3,
        anchorTo: 9,
        quote: '選んだ文',
      });
    });

    it('4つのキーが無い応答（page-level）は blockId 等が undefined のまま', async () => {
      const pageLevelThread = {
        id: 't-1',
        createdBy: { userId: 1, name: '田中 太郎' },
        resolvedAt: null,
        resolvedBy: null,
        createdAt: '2026-09-01T00:00:00Z',
        comments: [],
      };
      mockGet.mockResolvedValue({ data: { threads: [pageLevelThread] } });

      const [thread] = await KbRepository.listCommentThreads('acme', 'p-1');

      expect(thread.blockId).toBeUndefined();
      expect(thread.quote).toBeUndefined();
    });
  });

  describe('createCommentThread', () => {
    it('POST /comment-threads に body を送り、作った最初の 1 件込みのスレッドを返す', async () => {
      const body = [{ type: 'text', text: '質問です' }];
      const thread = {
        id: 't-1',
        createdBy: { userId: 1, name: '田中 太郎' },
        resolvedAt: null,
        resolvedBy: null,
        createdAt: '2026-09-01T00:00:00Z',
        comments: [
          {
            id: 'c-1',
            author: { userId: 1, name: '田中 太郎' },
            body,
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ],
      };
      mockPost.mockResolvedValue({ data: thread });

      const got = await KbRepository.createCommentThread('acme', 'p-1', body);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/comment-threads',
        { body },
      );
      expect(got).toEqual(thread);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('forbidden'));

      await expect(
        KbRepository.createCommentThread('acme', 'p-1', [{ type: 'text', text: 'x' }]),
      ).rejects.toThrow();
    });

    it('anchor を渡すと body に4つのフィールドを展開して送る（錨付きコメント）', async () => {
      const body = [{ type: 'text', text: '選んだ文への質問' }];
      const anchor = { blockId: 'block-1', anchorFrom: 3, anchorTo: 9, quote: '選んだ文' };
      const thread = {
        id: 't-1',
        createdBy: { userId: 1, name: '田中 太郎' },
        resolvedAt: null,
        resolvedBy: null,
        createdAt: '2026-09-01T00:00:00Z',
        comments: [],
        ...anchor,
      };
      mockPost.mockResolvedValue({ data: thread });

      const got = await KbRepository.createCommentThread('acme', 'p-1', body, anchor);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/comment-threads',
        {
          body,
          blockId: 'block-1',
          anchorFrom: 3,
          anchorTo: 9,
          quote: '選んだ文',
        },
      );
      expect(got).toMatchObject(anchor);
    });
  });

  describe('addComment', () => {
    it('POST /comment-threads/:threadId/comments に body を送り、追加した comment を返す', async () => {
      const body = [{ type: 'text', text: '返信です' }];
      const comment = {
        id: 'c-2',
        author: { userId: 2, name: '鈴木 花子' },
        body,
        createdAt: '2026-09-02T00:00:00Z',
        updatedAt: '2026-09-02T00:00:00Z',
      };
      mockPost.mockResolvedValue({ data: comment });

      const got = await KbRepository.addComment('acme', 'p-1', 't-1', body);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/comment-threads/t-1/comments',
        { body },
      );
      expect(got).toEqual(comment);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('forbidden'));

      await expect(
        KbRepository.addComment('acme', 'p-1', 't-1', [{ type: 'text', text: 'x' }]),
      ).rejects.toThrow();
    });
  });

  describe('resolveCommentThread / reopenCommentThread', () => {
    // backend は resolvedAt / resolvedBy を `*time.Time` / ポインタ + `omitempty` で返す。
    // 解決済みのときはキーが出るが、**未解決（reopen 直後）ではキー自体が応答に無い**
    // （null ではなく丸ごと欠ける）。comments も引き直さない設計で、常に空配列で返る。
    const resolvedWire = {
      id: 't-1',
      createdBy: { userId: 1, name: '田中 太郎' },
      resolvedAt: '2026-09-03T00:00:00Z',
      resolvedBy: { userId: 2, name: '鈴木 花子' },
      createdAt: '2026-09-01T00:00:00Z',
      comments: [],
    };
    const reopenedWire = {
      id: 't-1',
      createdBy: { userId: 1, name: '田中 太郎' },
      createdAt: '2026-09-01T00:00:00Z',
      comments: [],
      // resolvedAt / resolvedBy は無い（omitempty で欠ける）。
    };

    it('resolveCommentThread は POST /resolve を叩き、更新後のスレッドを返す', async () => {
      mockPost.mockResolvedValue({ data: resolvedWire });

      const got = await KbRepository.resolveCommentThread('acme', 'p-1', 't-1');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/comment-threads/t-1/resolve',
      );
      expect(got).toEqual(resolvedWire);
    });

    it('reopenCommentThread は POST /reopen を叩き、resolvedAt/resolvedBy が欠けた応答を null に正規化する', async () => {
      mockPost.mockResolvedValue({ data: reopenedWire });

      const got = await KbRepository.reopenCommentThread('acme', 'p-1', 't-1');

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/comment-threads/t-1/reopen',
      );
      // キーが無い応答でも、呼び出し側は必ず null で判定できる。
      expect(got.resolvedAt).toBeNull();
      expect(got.resolvedBy).toBeNull();
      expect(got.comments).toEqual([]);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.resolveCommentThread('acme', 'p-1', 't-1')).rejects.toThrow();
      await expect(KbRepository.reopenCommentThread('acme', 'p-1', 't-1')).rejects.toThrow();
    });
  });

  describe('resolvedAt / resolvedBy が欠けた応答の正規化（未解決のスレッド）', () => {
    // listCommentThreads / createCommentThread でも、未解決のスレッドは同じ理由で
    // resolvedAt / resolvedBy のキー自体が無い応答になり得る。
    const unresolvedWire = {
      id: 't-1',
      createdBy: { userId: 1, name: '田中 太郎' },
      createdAt: '2026-09-01T00:00:00Z',
      comments: [
        {
          id: 'c-1',
          author: { userId: 1, name: '田中 太郎' },
          body: [{ type: 'text', text: '質問です' }],
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        },
      ],
      // resolvedAt / resolvedBy は無い。
    };

    it('listCommentThreads は欠けたキーを null に正規化する', async () => {
      mockGet.mockResolvedValue({ data: { threads: [unresolvedWire] } });

      const [thread] = await KbRepository.listCommentThreads('acme', 'p-1');

      expect(thread.resolvedAt).toBeNull();
      expect(thread.resolvedBy).toBeNull();
    });

    it('createCommentThread は欠けたキーを null に正規化する', async () => {
      mockPost.mockResolvedValue({ data: unresolvedWire });

      const thread = await KbRepository.createCommentThread('acme', 'p-1', [
        { type: 'text', text: '質問です' },
      ]);

      expect(thread.resolvedAt).toBeNull();
      expect(thread.resolvedBy).toBeNull();
    });
  });

  describe('listPageVersions', () => {
    it('GET /versions を叩き、一覧を配列で返す', async () => {
      const version = {
        seq: 3,
        author: { userId: 1, name: '田中 太郎' },
        note: 'リリース前の状態',
        createdAt: '2026-09-05T00:00:00Z',
      };
      mockGet.mockResolvedValue({ data: [version] });

      const versions = await KbRepository.listPageVersions('acme', 'p-1');

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/versions');
      expect(versions).toEqual([version]);
    });

    it('一覧が null で返っても空配列にする', async () => {
      mockGet.mockResolvedValue({ data: null });

      await expect(KbRepository.listPageVersions('acme', 'p-1')).resolves.toEqual([]);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockGet.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.listPageVersions('acme', 'p-1')).rejects.toThrow();
    });
  });

  describe('getPageVersion', () => {
    it('GET /versions/:seq に seq を埋め、doc 込みの1件を返す', async () => {
      const detail = {
        seq: 3,
        author: { userId: 1, name: '田中 太郎' },
        note: null,
        createdAt: '2026-09-05T00:00:00Z',
        doc: { type: 'doc', content: [] },
      };
      mockGet.mockResolvedValue({ data: detail });

      const got = await KbRepository.getPageVersion('acme', 'p-1', 3);

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/versions/3');
      expect(got).toEqual(detail);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockGet.mockRejectedValue(new Error('not found'));

      await expect(KbRepository.getPageVersion('acme', 'p-1', 3)).rejects.toThrow();
    });
  });

  describe('createPageVersion', () => {
    it('note を渡すと POST /versions に { note } を送る', async () => {
      const created = {
        seq: 4,
        author: { userId: 1, name: '田中 太郎' },
        note: 'リリース前の状態',
        createdAt: '2026-09-06T00:00:00Z',
        doc: { type: 'doc', content: [] },
      };
      mockPost.mockResolvedValue({ data: created });

      const got = await KbRepository.createPageVersion('acme', 'p-1', 'リリース前の状態');

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/versions', {
        note: 'リリース前の状態',
      });
      expect(got).toEqual(created);
    });

    it('note を省くと空の body で送る（空のメモも作れる）', async () => {
      mockPost.mockResolvedValue({
        data: { seq: 5, author: { userId: 1, name: '田中 太郎' }, note: null, createdAt: '2026-09-06T00:00:00Z', doc: {} },
      });

      await KbRepository.createPageVersion('acme', 'p-1');

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/versions', {});
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.createPageVersion('acme', 'p-1', 'x')).rejects.toThrow();
    });
  });

  describe('note が欠けた応答の正規化（メモを付けていない版）', () => {
    // backend は note を Go の `*string` + `omitempty` で返す。メモを付けていない版では
    // **キー自体が応答に無い**（null ではなく丸ごと欠ける — resolvedAt/resolvedBy と同じ理由）。
    const versionWithoutNoteKey = {
      seq: 7,
      author: { userId: 1, name: '田中 太郎' },
      createdAt: '2026-09-05T00:00:00Z',
      // note キー自体が無い。
    };

    it('listPageVersions は欠けた note を null に正規化する', async () => {
      mockGet.mockResolvedValue({ data: [versionWithoutNoteKey] });

      const [version] = await KbRepository.listPageVersions('acme', 'p-1');

      expect(version.note).toBeNull();
    });

    it('getPageVersion は欠けた note を null に正規化する', async () => {
      mockGet.mockResolvedValue({ data: { ...versionWithoutNoteKey, doc: { type: 'doc', content: [] } } });

      const detail = await KbRepository.getPageVersion('acme', 'p-1', 7);

      expect(detail.note).toBeNull();
    });

    it('createPageVersion は欠けた note を null に正規化する', async () => {
      mockPost.mockResolvedValue({ data: { ...versionWithoutNoteKey, doc: { type: 'doc', content: [] } } });

      const created = await KbRepository.createPageVersion('acme', 'p-1');

      expect(created.note).toBeNull();
    });
  });

  describe('restorePageVersion', () => {
    it('POST /versions/:seq/restore を body 無しで叩き、本文保存と同じ形の応答を返す', async () => {
      const result = {
        doc: { type: 'doc', content: [] },
        builtAt: '2026-09-06T00:00:00Z',
        lastEditedBy: { userId: 1, name: '田中 太郎' },
        lastEditedAt: '2026-09-06T00:00:00Z',
      };
      mockPost.mockResolvedValue({ data: result });

      const got = await KbRepository.restorePageVersion('acme', 'p-1', 3);

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/pages/p-1/versions/3/restore',
      );
      expect(got).toEqual(result);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.restorePageVersion('acme', 'p-1', 3)).rejects.toThrow();
    });
  });

  describe('listPageTemplates', () => {
    it('spaceId を省くと params 無しで GET する', async () => {
      mockGet.mockResolvedValue({ data: [] });

      await KbRepository.listPageTemplates('acme');

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/templates', {
        params: undefined,
      });
    });

    it('spaceId を渡すと params に乗せる', async () => {
      const template = { id: 't-1', name: '議事録', createdAt: '2026-09-01T00:00:00Z' };
      mockGet.mockResolvedValue({ data: [template] });

      const got = await KbRepository.listPageTemplates('acme', 's-1');

      expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/templates', {
        params: { spaceId: 's-1' },
      });
      expect(got).toEqual([template]);
    });

    it('一覧が null で返っても空配列にする', async () => {
      mockGet.mockResolvedValue({ data: null });

      await expect(KbRepository.listPageTemplates('acme')).resolves.toEqual([]);
    });

    it('失敗は握り潰さず投げる', async () => {
      mockGet.mockRejectedValue(new Error('boom'));

      await expect(KbRepository.listPageTemplates('acme')).rejects.toThrow();
    });
  });

  describe('createPageTemplate', () => {
    it('POST /pages/:id/templates に name と spaceId を送る', async () => {
      const created = { id: 't-1', name: '議事録', spaceId: 's-1', createdAt: '2026-09-01T00:00:00Z' };
      mockPost.mockResolvedValue({ data: created });

      const got = await KbRepository.createPageTemplate('acme', 'p-1', {
        name: '議事録',
        spaceId: 's-1',
      });

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/templates', {
        name: '議事録',
        spaceId: 's-1',
      });
      expect(got).toEqual(created);
    });

    it('spaceId に null を渡すとそのまま送る（ワークスペース全体）', async () => {
      mockPost.mockResolvedValue({ data: { id: 't-1', name: '議事録', createdAt: '' } });

      await KbRepository.createPageTemplate('acme', 'p-1', { name: '議事録', spaceId: null });

      expect(mockPost).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/pages/p-1/templates', {
        name: '議事録',
        spaceId: null,
      });
    });

    it('名前の重複（409）も含め、失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('duplicate_name'));

      await expect(
        KbRepository.createPageTemplate('acme', 'p-1', { name: '議事録' }),
      ).rejects.toThrow();
    });
  });

  describe('deletePageTemplate', () => {
    it('DELETE /templates/:id を叩く', async () => {
      mockDelete.mockResolvedValue({ data: undefined });

      await KbRepository.deletePageTemplate('acme', 't-1');

      expect(mockDelete).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/templates/t-1');
    });

    it('失敗は握り潰さず投げる', async () => {
      mockDelete.mockRejectedValue(new Error('forbidden'));

      await expect(KbRepository.deletePageTemplate('acme', 't-1')).rejects.toThrow();
    });
  });

  describe('createPageFromTemplate', () => {
    it('POST /spaces/:id/pages/from-template に templateId・title を送る', async () => {
      const page = { id: 'p-new', spaceId: 's-1', title: '議事録' };
      mockPost.mockResolvedValue({ data: page });

      const got = await KbRepository.createPageFromTemplate('acme', 's-1', {
        templateId: 't-1',
        title: '議事録',
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/spaces/s-1/pages/from-template',
        { templateId: 't-1', title: '議事録' },
      );
      expect(got).toEqual(page);
    });

    it('parentId を渡すとそのまま送る', async () => {
      mockPost.mockResolvedValue({ data: { id: 'p-new' } });

      await KbRepository.createPageFromTemplate('acme', 's-1', {
        templateId: 't-1',
        parentId: 'p-parent',
        title: '議事録',
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/api/v2/kb/workspaces/acme/spaces/s-1/pages/from-template',
        { templateId: 't-1', parentId: 'p-parent', title: '議事録' },
      );
    });

    it('失敗は握り潰さず投げる', async () => {
      mockPost.mockRejectedValue(new Error('boom'));

      await expect(
        KbRepository.createPageFromTemplate('acme', 's-1', { templateId: 't-1', title: 'x' }),
      ).rejects.toThrow();
    });
  });
});
