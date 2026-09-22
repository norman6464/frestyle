import { useState } from 'react';
import {
  InkwellButton,
  InkwellTextField,
  InkwellCard,
  InkwellCardContent,
  InkwellCardActions,
  InkwellCheckbox,
  InkwellSwitch,
  InkwellLoadingButton,
  InkwellCircularProgress,
  InkwellLinearProgress,
  InkwellSkeleton,
} from '@/shared/ui/inkwell';

/** デモ用: n ミリ秒後に解決/reject する擬似非同期処理。 */
const wait = (ms: number, fail = false) =>
  new Promise<void>((resolve, reject) => setTimeout(() => (fail ? reject() : resolve()), ms));

/**
 * inkwell プリミティブの見た目確認用カタログ（開発・レビュー用）。
 * アプリ本体のテーマとは独立した触感的コンポーネント群を一覧する。
 */
export default function InkwellShowcasePage() {
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [progress, setProgress] = useState(50);

  return (
    <div className="h-full overflow-y-auto bg-[#f5f5f5] font-roboto text-inkwell-text-primary">
      <div className="mx-auto min-h-full max-w-4xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
        <header>
          <h1 className="text-3xl font-medium">inkwell UI カタログ</h1>
          <p className="mt-1 text-inkwell-text-secondary">押下波紋・標高シャドウ・浮き上がるラベルを Tailwind だけで実装した触感的プリミティブ。</p>
        </header>

        <Section title="Button — 塗り (contained)">
          <InkwellButton>Primary</InkwellButton>
          <InkwellButton color="secondary">Secondary</InkwellButton>
          <InkwellButton color="error">Error</InkwellButton>
          <InkwellButton disabled>Disabled</InkwellButton>
        </Section>

        <Section title="Button — 枠線 (outlined) / 文字のみ (text)">
          <InkwellButton variant="outlined">Outlined</InkwellButton>
          <InkwellButton variant="outlined" color="secondary">Outlined</InkwellButton>
          <InkwellButton variant="text">Text</InkwellButton>
          <InkwellButton variant="text" color="error">Text</InkwellButton>
        </Section>

        <Section title="Button — サイズ">
          <InkwellButton size="small">Small</InkwellButton>
          <InkwellButton size="medium">Medium</InkwellButton>
          <InkwellButton size="large">Large</InkwellButton>
        </Section>

        <Section title="TextField — 枠線 + 浮き上がるラベル">
          <div className="flex flex-wrap gap-6">
            <InkwellTextField label="お名前" />
            <InkwellTextField label="メール" helperText="社内アドレスを入力" defaultValue="taro@example.jp" />
            <InkwellTextField label="パスワード" type="password" error helperText="8 文字以上にしてください" />
            <InkwellTextField label="無効" disabled />
          </div>
        </Section>

        <Section title="Card — 標高">
          <div className="flex flex-wrap gap-4">
            {([0, 1, 2, 4, 8] as const).map((e) => (
              <InkwellCard key={e} elevation={e} className="w-44">
                <InkwellCardContent>
                  <p className="text-sm font-medium">elevation {e}</p>
                  <p className="mt-1 text-xs text-inkwell-text-secondary">数字が大きいほど浮いて見える</p>
                </InkwellCardContent>
                <InkwellCardActions className="justify-end">
                  <InkwellButton variant="text" size="small">
                    詳細
                  </InkwellButton>
                </InkwellCardActions>
              </InkwellCard>
            ))}
          </div>
        </Section>

        <Section title="Checkbox / Switch">
          <div className="flex flex-wrap items-center gap-6">
            <InkwellCheckbox label="同意する" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <InkwellCheckbox label="未チェック" checked={false} readOnly />
            <InkwellCheckbox label="無効" disabled />
            <InkwellSwitch label="通知" checked={on} onChange={(e) => setOn(e.target.checked)} />
            <InkwellSwitch label="無効" disabled />
          </div>
        </Section>

        <Section title="LoadingButton — 押下で送信中→完了/失敗">
          <InkwellLoadingButton onAction={() => wait(1400)} successLabel="保存しました">
            保存する
          </InkwellLoadingButton>
          <InkwellLoadingButton
            color="error"
            onAction={() => wait(1400, true)}
            errorLabel="削除に失敗しました"
          >
            削除する
          </InkwellLoadingButton>
          <InkwellLoadingButton variant="outlined" onAction={() => wait(1400)}>
            送信する
          </InkwellLoadingButton>
        </Section>

        <Section title="Progress — 円形 / 線形（確定・不確定）">
          <div className="flex w-full flex-col gap-5">
            <div className="flex flex-wrap items-center gap-6 text-inkwell-primary">
              <InkwellCircularProgress />
              <InkwellCircularProgress value={progress} aria-label="読み込みの進み具合" />
              <InkwellCircularProgress value={progress} size={28} thickness={3} aria-label="読み込みの進み具合（小）" />
              <InkwellButton size="small" variant="outlined" onClick={() => setProgress((p) => (p >= 100 ? 0 : p + 25))}>
                進める（{progress}%）
              </InkwellButton>
            </div>
            <div className="space-y-3">
              <InkwellLinearProgress />
              <InkwellLinearProgress value={progress} aria-label="読み込みの進み具合" />
            </div>
          </div>
        </Section>

        <Section title="Skeleton — 読み込み中プレースホルダ">
          <div className="flex w-full max-w-sm items-center gap-3">
            <InkwellSkeleton variant="circle" />
            <div className="flex-1 space-y-2">
              <InkwellSkeleton variant="text" className="w-2/3" />
              <InkwellSkeleton variant="text" />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-inkwell-text-secondary">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}
