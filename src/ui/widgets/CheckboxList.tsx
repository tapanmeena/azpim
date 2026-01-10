import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

export type CheckboxItem = {
  key: string;
  label: string;
  meta?: string;
};

export type CheckboxListProps = {
  items: CheckboxItem[];
  isLoading?: boolean;
  emptyLabel?: string;
  onSubmit: (selectedKeys: string[]) => void;
};

export const CheckboxList: React.FC<CheckboxListProps> = ({ items, isLoading, emptyLabel, onSubmit }) => {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const safeItems = useMemo(() => items ?? [], [items]);
  const maxIndex = Math.max(0, safeItems.length - 1);

  const selectedKeys = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  useInput(
    (input, key) => {
      if (isLoading) return;
      if (safeItems.length === 0) return;

      if (key.upArrow) setCursor((i) => (i <= 0 ? maxIndex : i - 1));
      if (key.downArrow) setCursor((i) => (i >= maxIndex ? 0 : i + 1));

      if (input === " ") {
        const item = safeItems[cursor];
        if (!item) return;
        setSelected((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
      }

      if (input === "a") {
        const allSelected = safeItems.every((it) => selected[it.key]);
        if (allSelected) {
          setSelected({});
        } else {
          const next: Record<string, boolean> = {};
          for (const it of safeItems) next[it.key] = true;
          setSelected(next);
        }
      }

      if (input === "i") {
        const next: Record<string, boolean> = {};
        for (const it of safeItems) next[it.key] = !selected[it.key];
        setSelected(next);
      }

      if (key.return) {
        onSubmit(selectedKeys);
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
        const isActive = i === cursor;
        const isChecked = !!selected[item.key];
        return (
          <Box key={item.key}>
            <Text color={isActive ? "green" : undefined}>{isActive ? "❯" : " "}</Text>
            <Text> </Text>
            <Text>{isChecked ? "◉" : "◯"}</Text>
            <Text> </Text>
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
        <Text dimColor>↑↓ navigate · Space toggle · a all · i invert · Enter submit</Text>
      </Box>
      <Box>
        <Text dimColor>Selected: {selectedKeys.length}</Text>
      </Box>
    </Box>
  );
};
