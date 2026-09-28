import { Profiler } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { queryWrapper } from "@/test/queryClient";
import KbSearchDialog from "../KbSearchDialog";

const hoisted = vi.hoisted(() => ({ searchPages: vi.fn() }));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock("@/entities/kb/api/kbRepository", () => ({
  default: { searchPages: hoisted.searchPages },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // 応答は返さない（打った直後の描画だけを見る）。
  hoisted.searchPages.mockImplementation(() => new Promise(() => {}));
});

/** 画面に反映された回数（React の commit）を数えながら描く。 */
function renderCounted() {
  const commits = { count: 0 };
  const Wrapper = queryWrapper();
  render(
    <Wrapper>
      <Profiler
        id="search"
        onRender={() => {
          commits.count += 1;
        }}
      >
        <MemoryRouter>
          <KbSearchDialog workspaceSlug="acme" spaces={[]} onClose={vi.fn()} />
        </MemoryRouter>
      </Profiler>
    </Wrapper>,
  );
  return commits;
}

describe("KbSearchDialog の描き直し", () => {
  it("打った描画の中で「検索中」にする（検索中にするためにもう 1 回描き直さない）", () => {
    const commits = renderCounted();
    commits.count = 0;

    fireEvent.change(screen.getByLabelText("ページを題名・本文で検索"), {
      target: { value: "設計" },
    });

    expect(screen.getByText("検索中…")).toBeInTheDocument();
    expect(commits.count).toBe(1);
  });

  it("空に戻した描画の中で、はじめの案内に戻す", () => {
    const commits = renderCounted();
    const input = screen.getByLabelText("ページを題名・本文で検索");
    fireEvent.change(input, { target: { value: "設計" } });
    commits.count = 0;

    fireEvent.change(input, { target: { value: "" } });

    expect(
      screen.getByText("ワークスペース全体から題名・本文で探します"),
    ).toBeInTheDocument();
    expect(commits.count).toBe(1);
  });
});

describe('KbSearchDialog の問い合わせ', () => {
  it('打ち直して前の語へ戻したら、問い合わせの応答を待たずに前の結果を出す（裏で取り直す）', async () => {
    const answered = new Set<string>();
    hoisted.searchPages.mockImplementation((_slug: string, needle: string) => {
      // 2 回目以降の問い合わせは返事をしない（控えから出していることを確かめるため）。
      if (answered.has(needle)) return new Promise(() => {});
      answered.add(needle);
      return Promise.resolve([
        { id: `p-${needle}`, title: `${needle}の結果`, spaceId: 's-1', spaceName: '開発部', excerpt: '' },
      ]);
    });
    renderCounted();
    const input = screen.getByLabelText('ページを題名・本文で検索');

    fireEvent.change(input, { target: { value: '設計' } });
    expect(await screen.findByText('設計の結果')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '手順' } });
    expect(await screen.findByText('手順の結果')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '設計' } });

    expect(await screen.findByText('設計の結果')).toBeInTheDocument();
  });
});
