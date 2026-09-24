import { useEffect, useRef } from 'react';
import type { Decorator } from '@storybook/react-vite';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, parsePath } from 'react-router-dom';
import { authReducer } from '@/entities/user';
import { ToastProvider } from '@/app/providers/ToastProvider';
import ToastContainer from '@/app/providers/ToastContainer';
import apiClient from '@/shared/api/axios';

/*
 * story を単体で描くための「まわりの装置」。
 *
 * アプリの部品は、素の React だけでは動かないものがある。リンクは react-router が、
 * ログイン状態は Redux が居ないと落ちる。ここでは **その最小限だけ** を用意する。
 * 本物の App を通すと、story が「アプリの起動」になってしまい、部品の見本にならない。
 */

/**
 * withRouter — `<Link>` や `useNavigate` を使う部品を単体で描けるようにする。
 *
 * MemoryRouter は URL をブラウザではなく記憶の中だけで持つ router。story の中で
 * リンクを押しても Storybook の画面ごと遷移してしまうことがない。
 */
export const withRouter: Decorator = (Story) => (
  <MemoryRouter>
    <Story />
  </MemoryRouter>
);

/**
 * routerAt — 「いまどの URL に居るか」で見た目が変わる部品のためのデコレータ。
 *
 * 例: PublicHeader は /signup に居るときだけ「ログイン」を出す。初期 URL を
 * 変えられないと、片方の見え方しか story にできない。
 */
export function routerAt(initialPath: string): Decorator {
  const Wrapped: Decorator = (Story) => (
    <MemoryRouter initialEntries={[initialPath]}>
      <Story />
    </MemoryRouter>
  );
  return Wrapped;
}

/**
 * routerWithParam — `useParams()` を読む部品のためのデコレータ。
 *
 * `useParams` は「どの Route に入っているか」から値を取るので、Route の型
 * （`/kb/:pageId` のような形）に嵌めないと常に undefined になる。
 */
export function routerWithParam(pattern: string, path: string): Decorator {
  // story ごとに `parameters.routerState` で、開いたときの location.state を差し込める
  // （「どこから来たか」で振る舞いが変わる画面を、router を重ねずに描くため）。
  const Wrapped: Decorator = (Story, { parameters }) => {
    const state = (parameters as { routerState?: unknown }).routerState;
    return (
      <MemoryRouter initialEntries={[state === undefined ? path : { ...parsePath(path), state }]}>
        <Routes>
          <Route path={pattern} element={<Story />} />
        </Routes>
      </MemoryRouter>
    );
  };
  return Wrapped;
}

/** ログイン状態。Redux の auth slice が持っている中身と同じ形。 */
export interface AuthPreload {
  isAuthenticated: boolean;
  loading: boolean;
}

/**
 * withStore — Redux に触る部品を単体で描けるようにする。
 *
 * story ごとに**作り直す**。使い回すと、片方の story で起きた変化が別の story に
 * 残り、単体で開いたときと全部まとめて開いたときで見え方が変わる。
 */
export function withStore(auth: AuthPreload = { isAuthenticated: true, loading: false }): Decorator {
  const Wrapped: Decorator = (Story) => (
    <Provider
      store={configureStore({
        reducer: { auth: authReducer },
        preloadedState: { auth },
      })}
    >
      <Story />
    </Provider>
  );
  return Wrapped;
}

/**
 * withAppFrame — ログイン後の画面をアプリと同じ地色・余白の中で見るための枠。
 *
 * 画面まるごとの story を素で置くと、白地に浮いて実物と印象が変わる。
 */
export const withAppFrame: Decorator = (Story) => (
  <div className="min-h-[600px] bg-surface p-6">
    <Story />
  </div>
);

/**
 * withToast — 「知らせ（トースト）」を出す部品のためのデコレータ。
 *
 * `useToast()` は入れものが無いと例外を投げる作りになっている（黙って何も出ないより、
 * 配線し忘れがその場で分かるほうがよい、という判断）。story でも本物の入れものを通す。
 * 出た知らせが目に見えるよう、表示側（ToastContainer）も一緒に置く。
 */
export const withToast: Decorator = (Story) => (
  <ToastProvider>
    <Story />
    <ToastContainer />
  </ToastProvider>
);

/**
 * 通信の見本。鍵は「URL に含まれる文字列」で、値はそのとき返す中身。
 *
 * 例: `{ '/auth/me': { id: 1 }, '/kb/workspaces': [] }`
 * 関数を渡すと、その場で組み立てられる（送った中身に応じて返り値を変えたいとき）。
 *
 * 突き合わせは**書いた順に前から**。`/notifications/unread-count` のように、片方が
 * もう片方を含む宛先があるときは、**細かいほうを先に書く**（`/notifications` が先だと
 * 一覧の中身が件数の代わりに返る）。
 */
export type ApiStubs = Record<
  string,
  unknown | ((config: { url?: string; method?: string; data?: unknown }) => unknown)
>;

/**
 * 見本の中に無い宛先は 404 として**投げる**。黙って空を返すより、配線漏れが story で見える
 * ほうがよい。「取得に失敗したとき」の見本も、この 404 をそのまま使って作れる。
 *
 * 投げるのは自分の仕事。axios は組み込みの通信部分の中で「2xx 以外は失敗」を判定しており、
 * 通信部分ごと差し替えるとその判定も一緒に外れる（返しただけでは成功として扱われ、
 * 失敗の道筋を通る story が全部「成功」になってしまう）。
 */
function stubAdapter(stubs: ApiStubs) {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const url = config.url ?? '';
    const hit = Object.keys(stubs).find((pattern) => url.includes(pattern));
    if (hit === undefined) {
      const error = new Error(`見本に無い宛先です: ${url}`) as Error & {
        response: AxiosResponse;
        config: InternalAxiosRequestConfig;
        isAxiosError: boolean;
      };
      error.isAxiosError = true;
      error.config = config;
      error.response = {
        data: null,
        status: 404,
        statusText: 'Not Found',
        headers: {},
        config,
      } as AxiosResponse;
      throw error;
    }
    const body = stubs[hit];
    const data = typeof body === 'function' ? body(config) : body;
    return { data, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse;
  };
}

/**
 * withApi — サーバーへ問い合わせる部品を、サーバー無しで描くためのデコレータ。
 *
 * axios の「実際に送る部分」だけを差し替える。呼び出し側（リポジトリ）には手を入れないので、
 * URL の組み立てや戻り値の解釈といった**本物の道筋をそのまま通る**。
 *
 * 差し替えは effect ではなく描画の途中で行う。部品は最初の描画の直後に問い合わせるので、
 * effect まで待つと本物の通信が先に飛んでしまう。
 */
function withStubbedAdapter(client: AxiosInstance, stubs: ApiStubs): Decorator {
  const Wrapped: Decorator = (Story) => {
    const original = useRef<unknown>(undefined);
    if (original.current === undefined) {
      original.current = client.defaults.adapter ?? null;
      client.defaults.adapter = stubAdapter(stubs);
    }
    useEffect(
      () => () => {
        // story を離れたら必ず戻す。戻さないと、次に開いた story まで見本の通信のままになる。
        client.defaults.adapter = (original.current ?? undefined) as typeof client.defaults.adapter;
      },
      [],
    );
    return <Story />;
  };
  return Wrapped;
}

export function withApi(stubs: ApiStubs): Decorator {
  return withStubbedAdapter(apiClient, stubs);
}

/**
 * withRawPut — 署名付き URL への直接アップロード（`ImageUploadRepository.upload` や
 * `putTicketAttachmentFile` が使う「素の axios」。`@/shared/api/axios` の apiClient とは
 * 別のインスタンス）を差し替える。`withApi` は apiClient だけを差し替えるので、宛先が
 * Cloud Storage の署名付き URL であるこの経路はここで別に用意する。
 *
 * 既定（引数なし）はどの URL への PUT も無条件で成功にする（空文字は全 URL に一致する）。
 */
export function withRawPut(stubs: ApiStubs = { '': undefined }): Decorator {
  return withStubbedAdapter(axios, stubs);
}
