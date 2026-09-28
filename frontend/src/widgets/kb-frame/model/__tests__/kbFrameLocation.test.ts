import { describe, it, expect } from 'vitest';
import { INITIAL_KB_FRAME_STATE, applyKbFrameLocation, type KbFrameState } from '../kbFrameLocation';

const onPage: KbFrameState = {
  workspaceSlug: 'acme',
  spaceId: 'space-1',
  activePageId: 'p1',
  showPagePanel: true,
};

describe('applyKbFrameLocation', () => {
  it('まだ分からないワークスペースとスペース（undefined）は前のまま据え置く', () => {
    const next = applyKbFrameLocation(onPage, { activePageId: 'p2' });

    expect(next).toEqual({ workspaceSlug: 'acme', spaceId: 'space-1', activePageId: 'p2', showPagePanel: true });
  });

  it('開いているページと左の列の有無は持ち越さない（知らされなければ、ページは無し・左の列は出す）', () => {
    const members = applyKbFrameLocation(onPage, { workspaceSlug: 'acme', showPagePanel: false });
    expect(members).toEqual({ workspaceSlug: 'acme', spaceId: 'space-1', activePageId: undefined, showPagePanel: false });

    const back = applyKbFrameLocation(members, { workspaceSlug: 'acme', spaceId: 'space-1' });
    expect(back.showPagePanel).toBe(true);
  });

  it('ワークスペースが変わってスペースが知らされないときは、前のスペースを持ち越さない', () => {
    const next = applyKbFrameLocation(onPage, { workspaceSlug: 'beta', showPagePanel: false });

    expect(next.workspaceSlug).toBe('beta');
    expect(next.spaceId).toBe('');
  });

  it('ワークスペースと一緒に知らされたスペースはそのまま使う', () => {
    const next = applyKbFrameLocation(onPage, { workspaceSlug: 'beta', spaceId: 'space-9' });

    expect(next).toEqual({ workspaceSlug: 'beta', spaceId: 'space-9', activePageId: undefined, showPagePanel: true });
  });

  it('何も変わらなければ前の値をそのまま返す（新しい値を作ると、同じ位置でも枠を描き直す）', () => {
    const next = applyKbFrameLocation(onPage, { workspaceSlug: 'acme', spaceId: 'space-1', activePageId: 'p1' });

    expect(next).toBe(onPage);
  });

  it('最初はワークスペースもスペースも決まっていない', () => {
    const next = applyKbFrameLocation(INITIAL_KB_FRAME_STATE, { workspaceSlug: 'acme', spaceId: 'space-1' });

    expect(INITIAL_KB_FRAME_STATE).toEqual({ spaceId: '', showPagePanel: true });
    expect(next).toEqual({ workspaceSlug: 'acme', spaceId: 'space-1', activePageId: undefined, showPagePanel: true });
  });
});
