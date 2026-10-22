import type { Ref } from 'react';
import { Input, type InputProps, type InputRef } from 'antd';

type VndAmountInputProps = Omit<
  InputProps,
  'value' | 'onChange' | 'type' | 'inputMode' | 'suffix'
> & {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<InputRef>;
};

export function VndAmountInput({ value, onChange, inputRef, ...props }: VndAmountInputProps) {
  return (
    <Input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      suffix="VND"
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (/^\d*$/.test(nextValue)) onChange(nextValue);
      }}
    />
  );
}
