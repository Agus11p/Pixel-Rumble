import type { JSX } from 'react';
interface Props<T extends number> {
  label: string;
  options: readonly T[];
  value: T | number;
  onChange: (value: T) => void;
  suffix?: string;
  disabled?: boolean;
}

/** Selector de opciones fijas, en formato de videojuego (no un <select>). */
export function OptionRow<T extends number>({
  label,
  options,
  value,
  onChange,
  suffix = '',
  disabled = false,
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
            {opt}
            {suffix}
          </button>
        ))}
      </div>
    </div>
  );
}
