import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

type AutoResizeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> & { value: string };

/** 長い題名も省略せず、内容と幅に合わせて伸びる入力欄。 */
export default function AutoResizeTextarea({ value, className = '', ...props }: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (next !== width) { width = next; resize(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return <textarea {...props} ref={ref} rows={1} value={value} className={`block resize-none overflow-hidden ${className}`} />;
}
