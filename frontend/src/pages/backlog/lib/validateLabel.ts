/**
 * ラベルの名前・色を、送信する前に画面側で検査する。backend の境界と合わせてある
 * （`domain.MaxLabelNameLen` = 64、`domain.ValidHexColor` = `#` + 16進 6 桁）。
 *
 * 名前の重複（409 label_name_taken）はここでは見ない — 検査の時点では
 * プロジェクト内の他のラベルと突き合わせる必要があり、それは呼び出し側が持つ一覧を
 * 使って別に行う（この関数は 1 件だけで完結する検査に留める）。
 */

export const MAX_LABEL_NAME_LENGTH = 64;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export interface LabelValidationError {
  name?: string;
  color?: string;
}

export function validateLabel(name: string, color: string): LabelValidationError | null {
  const errors: LabelValidationError = {};
  if (name.trim() === '') {
    errors.name = 'ラベル名を入力してください。';
  } else if (name.length > MAX_LABEL_NAME_LENGTH) {
    errors.name = `ラベル名は ${MAX_LABEL_NAME_LENGTH} 文字までです。`;
  }
  if (!HEX_COLOR.test(color)) {
    errors.color = '色を選んでください。';
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/** 送信前に色を backend と同じ正規形（小文字）へ畳む。 */
export function normalizeLabelColor(color: string): string {
  return color.toLowerCase();
}
