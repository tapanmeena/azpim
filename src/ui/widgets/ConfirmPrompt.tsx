import { Box, Text, useInput } from "ink";
import React from "react";

export type ConfirmPromptProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmPrompt: React.FC<ConfirmPromptProps> = ({ message, onConfirm, onCancel }) => {
  useInput((input, key) => {
    if (key.return) {
      onConfirm();
      return;
    }

    if (input.toLowerCase() === "y") {
      onConfirm();
      return;
    }

    if (input.toLowerCase() === "n") {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text>{message}</Text>
      <Text dimColor>y = confirm · n = cancel · Enter = confirm</Text>
    </Box>
  );
};
