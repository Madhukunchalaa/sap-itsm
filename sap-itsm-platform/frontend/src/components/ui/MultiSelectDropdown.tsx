import React, { useRef, useEffect, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  /** Optional color class applied to the checkbox when an option is selected */
  colorMap?: Record<string, string>;
}

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = 'All',
  colorMap,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between text-sm border rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${
          selected.length > 0
            ? 'border-blue-400 text-blue-700'
            : 'border-gray-200 text-gray-700'
        }`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 ml-1 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {/* Clear all / Select all row */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 bg-gray-50">
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => onChange(options.map((o) => o.value))}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              All
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {options.map((opt) => {
              const isSelected = selected.includes(opt.value);
              const color = colorMap?.[opt.value];
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 text-left"
                >
                  {/* Checkbox */}
                  <span
                    className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      isSelected
                        ? (color ?? 'bg-blue-600 border-blue-600')
                        : 'bg-white border-gray-300'
                    }`}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                  </span>
                  <span className={isSelected ? 'text-gray-900 font-medium' : 'text-gray-700'}>
                    {opt.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
