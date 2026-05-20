const fs = require('fs');
const path = require('path');

const CANVAS = 1200;
const PADDING = 30;
const SQUARE_SIZE = (CANVAS - 2 * PADDING) / 6; // 190px

function squareCenter(col, row) {
  return {
    x: PADDING + (col - 0.5) * SQUARE_SIZE,
    y: PADDING + (6 - row + 0.5) * SQUARE_SIZE,
  };
}

const SUBCELL = SQUARE_SIZE / 3;

// Convert position 1–9 to canvas coords within a square.
// Grid layout (left→right, bottom→top):  7 8 9 / 4 5 6 / 1 2 3
function positionToXY(column_id, row_id, pos) {
  const subCol = (pos - 1) % 3;
  const subRow = Math.floor((pos - 1) / 3);
  return {
    x: Math.round(PADDING + (column_id - 1) * SQUARE_SIZE + (subCol + 0.5) * SUBCELL),
    y: Math.round(PADDING + (6 - row_id) * SQUARE_SIZE + (2 - subRow + 0.5) * SUBCELL),
  };
}

function computeCoordinates(fields) {
  return fields.map(f => ({ ...f, ...positionToXY(f.column_id, f.row_id, f.position) }));
}

function loadBoard(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.trim().split('\n').filter(l => l.trim());
  const fields = lines.slice(1).map(line => {
    const p = line.trim().split(';');
    return {
      field_id: parseInt(p[0]),
      square_id: parseInt(p[1]),
      column_id: parseInt(p[2]),
      row_id: parseInt(p[3]),
      rapid_difficulty: parseInt(p[4]),
      tent_capacity: parseInt(p[5]),
      is_shop: p[6] === '1',
      is_fish: p[7] === '1',
      is_mushroom: p[8] === '1',
      position: parseInt(p[9]) || 5,
    };
  });
  return computeCoordinates(fields);
}

module.exports = { loadBoard, CANVAS, SQUARE_SIZE, PADDING, squareCenter };
