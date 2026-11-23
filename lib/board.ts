// lib/board.ts: Board engine and data serialization for radar-5.2

import {
  boardIssue,
  buildRadar,
} from './model.ts';
import type {
  BoardRow,
  RadarData,
  RadarRow,
  Snapshot,
} from './model.ts';

export type { BoardRow, RadarData, RadarRow };
export { boardIssue, buildRadar };

export function dataScript(radar: RadarData): string {
  return `window.RADAR = (function() { return ${JSON.stringify(radar)}; })();\n`;
}
