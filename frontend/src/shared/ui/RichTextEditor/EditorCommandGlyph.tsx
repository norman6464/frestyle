import FormatIcon from '../FormatIcon';
import FsIcon from '../icons/FsIcon';
import type { EditorCommand } from './editorCommands';

interface EditorCommandGlyphProps {
  command: Pick<EditorCommand, 'glyph' | 'icon'>;
  /** 字面（glyph）で出すときの見た目（太字の B を太く、など）。アイコンのときは使わない。 */
  glyphClassName?: string;
}

/**
 * EditorCommandGlyph は書式コマンドの見た目（アイコンか短い字面）を描く。
 *
 * 絵文字（🔗 🖼 ☑ など）は使わない。絵文字は OS やフォントで形も色も変わり、色の変数で
 * 塗れず、押下状態の色替えにも付いてこない。記号にならないもの（B / I / H1 など）だけを
 * 字面で出し、それ以外は線のアイコン（FormatIcon / FsIcon）で出す。
 */
export default function EditorCommandGlyph({ command, glyphClassName = '' }: EditorCommandGlyphProps) {
  if (command.icon?.set === 'format') {
    return <FormatIcon name={command.icon.name} size={16} />;
  }
  if (command.icon?.set === 'fs') {
    return <FsIcon name={command.icon.name} className="h-4 w-4" />;
  }
  return <span className={glyphClassName}>{command.glyph}</span>;
}
