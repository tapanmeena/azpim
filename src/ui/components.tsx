import React from "react";
import { Box, Text } from "ink";

export const NavBar: React.FC<{ title?: string }> = ({ title }) => {
  return (
    <Box borderStyle="round" paddingX={1} justifyContent="space-between">
      <Text>{title ?? "azp-cli"}</Text>
      <Text dimColor>
        Esc/b Back · m Menu · q Exit · ? Help
      </Text>
    </Box>
  );
};

export const Panel: React.FC<{ heading: string; children: React.ReactNode }> = ({ heading, children }) => {
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={0}>
      <Box marginBottom={1}>
        <Text bold>{heading}</Text>
      </Box>
      {children}
    </Box>
  );
};

export const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <Box flexDirection="column" gap={1}>
    <Text color="yellow">{message}</Text>
    <Text dimColor>Use m for menu, q to exit.</Text>
  </Box>
);

export const ErrorState: React.FC<{ message: string; details?: string }> = ({ message, details }) => (
  <Box flexDirection="column" gap={1}>
    <Text color="red">{message}</Text>
    {details ? <Text dimColor>{details}</Text> : null}
    <Text dimColor>Use m for menu, q to exit.</Text>
  </Box>
);

export const HelpOverlay: React.FC = () => (
  <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={1}>
    <Text bold>Help</Text>
    <Text>Esc / b: Back</Text>
    <Text>m: Main Menu</Text>
    <Text>q: Exit (confirmation)</Text>
    <Text>Ctrl+C: Exit (confirmation)</Text>
    <Text>?: Toggle Help</Text>
  </Box>
);

export const ExitConfirmModal: React.FC = () => (
  <Box flexDirection="column" borderStyle="round" paddingX={1} paddingY={1}>
    <Text bold>Exit?</Text>
    <Text dimColor>Press y to exit, n to cancel.</Text>
  </Box>
);
