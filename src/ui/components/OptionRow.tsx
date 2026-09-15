import type { JSX } from 'react';
interface Props<T extends number | string> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  suffix?: string;
  disabled?: boolean;
  /** Texto a mostrar por opcion. Por defecto, la opcion misma (ej. "60"). */
  formatOption?: (opt: T) => string;
}

/** Selector de opciones fijas, en formato de videojuego (no un <select>). */
export function OptionRow<T extends number | string>({
  label,
  options,
  value,
  onChange,
  suffix = '',
  disabled = false,
  formatOption,
}: Props<T>): JSX.Element {
  return (
    <div className="option-row">
      <span className="field-label">{label}</span>
      <div className="option-buttons">
        {options.map((opt) => (
          <button
            key={opt}
            className={`chip ${opt === value ? 'chip-active' : ''}`}
            onClick={() => onChange(opt)}
            disabled={disabled}
          >
            {formatOption ? formatOption(opt) : opt}
            {suffix}
          </button>
        ))}
      </div>
    </div>
  );
}
