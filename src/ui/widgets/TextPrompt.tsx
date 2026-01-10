import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

export type TextPromptProps = {
  label: string;
  initialValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | true;
  onSubmit: (value: string) => void;
};

export const TextPrompt: React.FC<TextPromptProps> = ({ label, initialValue, placeholder, validate, onSubmit }) => {
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);

  const display = useMemo(() => (value.length > 0 ? value : placeholder ?? ""), [value, placeholder]);

  useInput((input, key) => {
    if (key.return) {
      const result = validate ? validate(value) : true;
      if (result === true) {
        setError(null);
        onSubmit(value);
      } else {
        setError(result);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValue((v) => v + input);
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text>{label}</Text>
      </Box>
      <Box>
        <Text color="cyan">› </Text>
        <Text dimColor={value.length === 0}>{display}</Text>
      </Box>
      {error ? (
        <Box>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
      <Box>
        <Text dimColor>Type and press Enter</Text>
      </Box>
    </Box>
  );
};
