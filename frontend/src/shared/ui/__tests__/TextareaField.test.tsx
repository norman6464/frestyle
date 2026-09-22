import { render, screen, fireEvent } from '@testing-library/react';
import TextareaField from '../TextareaField';

describe('TextareaField', () => {
  it('ラベルが表示される', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('自己紹介')).toBeInTheDocument();
  });

  it('値が反映される', () => {
    render(<TextareaField label="自己紹介" name="bio" value="テスト値" onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('テスト値')).toBeInTheDocument();
  });

  it('入力時にonChangeが呼ばれる', () => {
    const onChange = vi.fn();
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('自己紹介'), { target: { value: 'テスト' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('文字数カウントが表示される', () => {
    render(<TextareaField label="自己紹介" name="bio" value="こんにちは" onChange={vi.fn()} maxLength={100} />);
    expect(screen.getByText('5 / 100')).toBeInTheDocument();
  });

  it('maxLength未指定時は文字数カウントが非表示', () => {
    render(<TextareaField label="自己紹介" name="bio" value="テスト" onChange={vi.fn()} />);
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it('プレースホルダーが表示される', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} placeholder="入力してください" />);
    expect(screen.getByPlaceholderText('入力してください')).toBeInTheDocument();
  });

  it('rows属性が反映される', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} rows={5} />);
    expect(screen.getByLabelText('自己紹介')).toHaveAttribute('rows', '5');
  });

  it('デフォルトのrows属性は3', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('自己紹介')).toHaveAttribute('rows', '3');
  });

  it('空文字列で文字数カウントが0を表示する', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} maxLength={100} />);
    expect(screen.getByText('0 / 100')).toBeInTheDocument();
  });

  it('maxLength属性がtextareaに設定される', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} maxLength={200} />);
    expect(screen.getByLabelText('自己紹介')).toHaveAttribute('maxlength', '200');
  });

  it('textarea要素がレンダリングされる', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('自己紹介').tagName).toBe('TEXTAREA');
  });

  it('エラーメッセージが表示される', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} error="必須項目です" />);
    expect(screen.getByText('必須項目です')).toBeInTheDocument();
  });

  it('エラー時にaria-invalidがtrueになる', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} error="エラー" />);
    expect(screen.getByLabelText('自己紹介')).toHaveAttribute('aria-invalid', 'true');
  });

  it('エラー時にボーダーが赤色になる', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} error="エラー" />);
    expect(screen.getByLabelText('自己紹介').className).toContain('border-danger');
  });

  it('エラーなし時にaria-invalidがfalseになる', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('自己紹介')).toHaveAttribute('aria-invalid', 'false');
  });

  it('エラーなし時にボーダーが通常色になる', () => {
    render(<TextareaField label="自己紹介" name="bio" value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('自己紹介').className).toContain('border-surface-3');
    expect(screen.getByLabelText('自己紹介').className).not.toContain('border-danger');
  });
});
