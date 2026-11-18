import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Convert a saved bill line quantity (in BOX / STRIP / TAB) to base TAB units,
 * matching how stock is added/deducted when the bill is saved.
 */
export function toBaseQty(line: { quantity?: number | null; unit?: string | null; tabs_per_strip?: number | null; strips_per_box?: number | null }): number {
  const qty = Number(line.quantity) || 0;
  const tabs = Number(line.tabs_per_strip) || 1;
  const strips = Number(line.strips_per_box) || 1;
  if (line.unit === 'BOX') return qty * strips * tabs;
  if (line.unit === 'STRIP') return qty * tabs;
  return qty;
}
