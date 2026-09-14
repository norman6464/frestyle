import { useState } from 'react';
import type { Label } from '@/entities/ticket';
import TicketLabelChip from './TicketLabelChip';
import TicketLabelPicker from './TicketLabelPicker';

export interface TicketLabelBarProps {
  /** このチケットに付いているラベル。 */
  attached: Label[];
  /** ワークスペースに定義されている全ラベル（ピッカーの選択肢）。 */
  allLabels: Label[];
  canEdit: boolean;
  onToggle: (label: Label) => void;
  onCreate: (name: string, color: string) => Promise<Label>;
}

/**
 * チケットのラベル帯。読むだけのときはチップの列だけ（＋ボタンは出さない）。
 * 編集できるときだけ選択（TicketLabelPicker）を開ける。
 */
export default function TicketLabelBar({ attached, allLabels, canEdit, onToggle, onCreate }: TicketLabelBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!canEdit && attached.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {attached.map((label) => (
          <TicketLabelChip key={label.id} label={label} />
        ))}
        {canEdit && (
          // ラベルが 1 つも無いときは記号だけにしない。「＋」では何が足せるのか分からず、
          // 5px 四方の的を押すまで確かめようがない。既に付いているなら、
          // 並んだチップが文脈になるので記号で足りる。
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            aria-label="ラベルを付ける"
            className={`inline-flex items-center gap-1 rounded border border-dashed border-surface-3 text-xs text-[var(--color-text-muted)] hover:bg-surface-2 ${
              attached.length === 0 ? 'px-2 py-0.5' : 'h-5 w-5 justify-center'
            }`}
          >
            <span aria-hidden="true">＋</span>
            {attached.length === 0 && <span>ラベルを追加</span>}
          </button>
        )}
      </div>
      {canEdit && pickerOpen && (
        <TicketLabelPicker
          labels={allLabels}
          attachedIds={attached.map((l) => l.id)}
          onToggle={onToggle}
          onCreate={onCreate}
        />
      )}
    </div>
  );
}
