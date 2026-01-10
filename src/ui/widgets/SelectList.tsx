import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

export type SelectListItem<T> = {
  key: string;
  label: string;
  value: T;
  meta?: string;
};

export type SelectListProps<T> = {
  items: SelectListItem<T>[];
  isLoading?: boolean;
  emptyLabel?: string;
  onSelect: (value: T) => void;
};

export const SelectList = <T,>({ items, isLoading, emptyLabel, onSelect }: SelectListProps<T>) => {
  const [index, setIndex] = useState(0);

  const safeItems = useMemo(() => items ?? [], [items]);
  const maxIndex = Math.max(0, safeItems.length - 1);

  useInput(
    (_input, key) => {
      if (isLoading) return;
      if (safeItems.length === 0) return;

      if (key.upArrow) setIndex((i) => (i <= 0 ? maxIndex : i - 1));
      if (key.downArrow) setIndex((i) => (i >= maxIndex ? 0 : i + 1));

      if (key.return) {
        const item = safeItems[index];
        if (item) onSelect(item.value);
      }
    },
    { isActive: !isLoading }
  );

  if (isLoading) {
    return (
      <Box>
        <Text dimColor>Loading…</Text>
      </Box>
    );
  }

  if (safeItems.length === 0) {
    return (
      <Box>
        <Text dimColor>{emptyLabel ?? "No items."}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {safeItems.map((item, i) => {
        const isSelected = i === index;
        return (
          <Box key={item.key}>
            <Text color={isSelected ? "green" : undefined}>{isSelected ? "❯ " : "  "}</Text>
            <Text>{item.label}</Text>
            {item.meta ? (
              <>
                <Text> </Text>
                <Text dimColor>{item.meta}</Text>
              </>
            ) : null}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate · Enter select</Text>
      </Box>
    </Box>
  );
};
