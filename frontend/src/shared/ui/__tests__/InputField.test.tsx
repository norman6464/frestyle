import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InputField from '../InputField';

describe('InputField', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ラベルが表示される', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} />);

    expect(screen.getByLabelText('メール')).toBeInTheDocument();
  });

  it('外部から更新された値を表示し、入力補助と説明を関連付ける', () => {
    const { rerender } = render(<InputField label="メール" name="email" value="" onChange={mockOnChange} autoComplete="email" hint="連絡先のメールアドレス" />);
    rerender(<InputField label="メール" name="email" value="member@example.com" onChange={mockOnChange} autoComplete="email" hint="連絡先のメールアドレス" />);
    expect(screen.getByLabelText('メール')).toHaveValue('member@example.com');
    expect(screen.getByLabelText('メール')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('メール')).toHaveAccessibleDescription('連絡先のメールアドレス');
  });

  it('クリア後は入力欄にフォーカスを戻す', () => {
    render(<InputField label="氏名" name="name" value="名前" onChange={mockOnChange} />);
    fireEvent.click(screen.getByRole('button', { name: '入力をクリア' }));
    expect(screen.getByLabelText('氏名')).toHaveFocus();
  });

  it('入力値が変更されるとonChangeが呼ばれる', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} />);

    fireEvent.change(screen.getByLabelText('メール'), { target: { value: 'test@example.com' } });
    expect(mockOnChange).toHaveBeenCalled();
  });

  it('値があるときクリアボタンが表示される', () => {
    render(<InputField label="メール" name="email" value="test" onChange={mockOnChange} />);

    const clearButton = screen.getByRole('button');
    expect(clearButton).toBeInTheDocument();
  });

  it('クリアボタンで入力値がリセットされる', () => {
    render(<InputField label="メール" name="email" value="test" onChange={mockOnChange} />);

    fireEvent.click(screen.getByRole('button'));
    // InputField は ChangeEvent<HTMLInputElement> 互換の synthetic event を生成する。
    // target は実 input element なので name / value のみ検証する。
    expect(mockOnChange).toHaveBeenCalledTimes(1);
    const callArg = mockOnChange.mock.calls[0][0];
    expect(callArg.target.name).toBe('email');
    expect(callArg.target.value).toBe('');
  });

  it('空の値ではクリアボタンが表示されない', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('デフォルトのtypeがtextである', () => {
    render(<InputField label="名前" name="name" value="" onChange={mockOnChange} />);
    expect(screen.getByLabelText('名前')).toHaveAttribute('type', 'text');
  });

  it('エラーメッセージが表示される', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} error="必須項目です" />);
    expect(screen.getByText('必須項目です')).toBeInTheDocument();
  });

  it('エラー時にaria-invalidがtrueになる', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} error="エラー" />);
    expect(screen.getByLabelText('メール')).toHaveAttribute('aria-invalid', 'true');
  });

  it('エラー時にaria-describedbyが設定される', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} error="エラー" />);
    expect(screen.getByLabelText('メール')).toHaveAttribute('aria-describedby', 'email-error');
    expect(screen.getByText('エラー')).toHaveAttribute('id', 'email-error');
  });

  it('エラーがない場合はエラーメッセージが表示されない', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} />);
    expect(screen.queryByText('必須項目です')).not.toBeInTheDocument();
  });

  it('エラー時にボーダーが赤色になる', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} error="エラー" />);
    const input = screen.getByLabelText('メール');
    expect(input.className).toContain('border-rose-500');
  });

  it('エラーがない場合はaria-invalidがfalseになる', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} />);
    expect(screen.getByLabelText('メール')).toHaveAttribute('aria-invalid', 'false');
  });

  it('エラーがない場合はaria-describedbyが設定されない', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} />);
    expect(screen.getByLabelText('メール')).not.toHaveAttribute('aria-describedby');
  });

  it('エラーがない場合はボーダーが通常色になる', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} />);
    const input = screen.getByLabelText('メール');
    expect(input.className).toContain('border-surface-3');
    expect(input.className).not.toContain('border-rose-500');
  });

  it('disabled時にinputが無効化される', () => {
    render(<InputField label="メール" name="email" value="" onChange={mockOnChange} disabled />);
    expect(screen.getByLabelText('メール')).toBeDisabled();
  });

  it('disabled時にクリアボタンが表示されない', () => {
    render(<InputField label="メール" name="email" value="test" onChange={mockOnChange} disabled />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('type="password"時にパスワード表示切替ボタンが表示される', () => {
    render(<InputField label="パスワード" name="password" type="password" value="secret" onChange={mockOnChange} />);
    expect(screen.getByLabelText('パスワードを表示')).toBeInTheDocument();
  });

  it('パスワード表示切替ボタンクリックでtype="text"に変わる', () => {
    render(<InputField label="パスワード" name="password" type="password" value="secret" onChange={mockOnChange} />);
    fireEvent.click(screen.getByLabelText('パスワードを表示'));
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('type', 'text');
  });

  it('再クリックでtype="password"に戻る', () => {
    render(<InputField label="パスワード" name="password" type="password" value="secret" onChange={mockOnChange} />);
    fireEvent.click(screen.getByLabelText('パスワードを表示'));
    fireEvent.click(screen.getByLabelText('パスワードを非表示'));
    expect(screen.getByLabelText('パスワード')).toHaveAttribute('type', 'password');
  });

  it('type="text"時はパスワード表示切替ボタンが表示されない', () => {
    render(<InputField label="メール" name="email" type="text" value="test" onChange={mockOnChange} />);
    expect(screen.queryByLabelText('パスワードを表示')).toBeNull();
  });

  it('type="password"時にクリアボタンが表示されない', () => {
    render(<InputField label="パスワード" name="password" type="password" value="secret" onChange={mockOnChange} />);
    expect(screen.queryByLabelText('入力をクリア')).toBeNull();
  });

  it('クリアボタンにaria-label="入力をクリア"が設定される', () => {
    render(<InputField label="メール" name="email" value="test" onChange={mockOnChange} />);
    expect(screen.getByLabelText('入力をクリア')).toBeInTheDocument();
  });
});
