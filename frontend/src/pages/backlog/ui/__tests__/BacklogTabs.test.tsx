import { useRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BacklogTabs from '../BacklogTabs';

/*
 * 一覧の面と設定の面は別の部品なので、行き来するとタブごと作り直される。本番と同じく、面ごとに
 * 別の部品がタブを描く形で確かめる。
 */
function Face({ current, title }: { current: 'backlog' | 'settings'; title: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <>
      <BacklogTabs projectId="p-1" current={current} fallbackFocusRef={headingRef} />
      <h1 ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
    </>
  );
}
function ListFace() {
  return <Face current="backlog" title="バックログ" />;
}
function SettingsFace() {
  return <Face current="settings" title="設定" />;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/backlog/:projectId" element={<ListFace />} />
        <Route path="/backlog/:projectId/settings" element={<SettingsFace />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BacklogTabs', () => {
  it('タブで別の部品の面へ移っても、押したタブにフォーカスが残る（先頭へ戻さない）', async () => {
    const user = userEvent.setup();
    renderAt('/backlog/p-1');

    await user.click(screen.getByRole('link', { name: '設定' }));

    const settings = await screen.findByRole('link', { name: '設定' });
    expect(settings).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(settings).toHaveFocus());
  });

  it('今いるタブにフォーカスが載らない（狭い画面で畳んでいる）ときは、面の見出しへ移す', async () => {
    const user = userEvent.setup();
    renderAt('/backlog/p-1');
    // jsdom は CSS を当てないので、畳んだタブ（display: none）にフォーカスが載らないことを写す
    // （リンクへの focus() を何もしないものに替える。見出しへの focus() はそのまま効く）。
    vi.spyOn(HTMLAnchorElement.prototype, 'focus').mockImplementation(() => {});

    await user.click(screen.getByRole('link', { name: '設定' }));

    const heading = await screen.findByRole('heading', { name: '設定' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('タブを押さずに開いたときは、フォーカスを動かさない', () => {
    renderAt('/backlog/p-1/settings');

    expect(screen.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page');
    expect(document.body).toHaveFocus();
  });
});
