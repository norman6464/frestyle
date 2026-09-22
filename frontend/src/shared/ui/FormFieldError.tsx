interface FormFieldErrorProps {
  name: string;
  error?: string;
}

export default function FormFieldError({ name, error }: FormFieldErrorProps) {
  if (!error) return null;
  return (
    <p id={`${name}-error`} role="alert" className="text-sm text-danger-ink mt-1">
      {error}
    </p>
  );
}
