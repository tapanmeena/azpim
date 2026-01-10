import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export type NumberPromptProps = {
  label: string;
  initialValue?: number;
  min?: number;
  max?: number;
  onSubmit: (value: number) => void;
};

export const NumberPrompt: React.FC<NumberPromptProps> = ({ label, initialValue, min, max, onSubmit }) => {
  const [value, setValue] = useState<number>(initialValue ?? 0);
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.upArrow) setValue((v) => v + 1);
    if (key.downArrow) setValue((v) => v - 1);

    if (input >= "0" && input <= "9") {
      setValue((v) => {
        const next = Number(String(v) === "0" ? input : `${v}${input}`);
        return Number.isFinite(next) ? next : v;
      });
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => Math.floor(v / 10));
      return;
    }

    if (key.return) {
      if (min !== undefined && value < min) {
        setError(`Must be ≥ ${min}`);
        return;
      }
      if (max !== undefined && value > max) {
        setError(`Must be ≤ ${max}`);
        return;
      }
      setError(null);
      onSubmit(value);
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text>{label}</Text>
      <Text>
        <Text color="cyan">› </Text>
        <Text>{value}</Text>
      </Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>Digits / ↑↓ adjust / Backspace / Enter submit</Text>
    </Box>
  );
};
