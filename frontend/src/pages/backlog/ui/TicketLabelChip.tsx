import type { Label } from '@/entities/ticket';
import { LabelChip } from '@/shared/ui';

export interface TicketLabelChipProps {
  label: Label;
}

/** TicketLabelChip はチケットのラベル 1 件の見た目。塗り方は shared/ui/LabelChip に委譲する。 */
export default function TicketLabelChip({ label }: TicketLabelChipProps) {
  return <LabelChip name={label.name} color={label.color} />;
}
