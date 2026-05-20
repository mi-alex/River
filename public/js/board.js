// Board renderer — draws the river path, fields, and player tokens on a Canvas

const CANVAS_SIZE = 1200;
const PADDING = 30;
const SQUARE_SIZE = (CANVAS_SIZE - 2 * PADDING) / 6; // 190
const FIELD_RADIUS = 14;
const PIECE_RADIUS = 10;

const RAPID_COLOR = '#e74c3c';
const FIELD_COLOR = '#2a3a5e';
const FIELD_STROKE = '#4a9eda';
const RIVER_COLOR = '#3a6ea8';

class BoardRenderer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.map = null;
    this.state = null;
    this.myPlayerId = null;
    this.onFieldHover = null;
    this.onFieldClick = null;
    canvasEl.width = CANVAS_SIZE;
    canvasEl.height = CANVAS_SIZE;
    canvasEl.style.width = CANVAS_SIZE + 'px';
    canvasEl.style.height = CANVAS_SIZE + 'px';

    canvasEl.addEventListener('mousemove', e => this._onMouseMove(e));
    canvasEl.addEventListener('mouseleave', () => { if (this.onFieldHover) this.onFieldHover(null); });
    canvasEl.addEventListener('click', e => this._onMouseClick(e));
  }

  setMap(map) { this.map = map; }
  setState(state) { this.state = state; this.draw(); }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  _fieldAt(x, y) {
    if (!this.map) return null;
    for (let i = this.map.length - 1; i >= 0; i--) {
      const f = this.map[i];
      const dx = f.x - x, dy = f.y - y;
      if (dx * dx + dy * dy <= (FIELD_RADIUS + 4) ** 2) return f;
    }
    return null;
  }

  _onMouseMove(e) {
    const { x, y } = this._canvasPos(e);
    const field = this._fieldAt(x, y);
    if (this.onFieldHover) this.onFieldHover(field, e.clientX, e.clientY);
  }

  _onMouseClick(e) {
    const { x, y } = this._canvasPos(e);
    const field = this._fieldAt(x, y);
    if (field && this.onFieldClick) this.onFieldClick(field);
  }

  draw() {
    if (!this.map) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    this._drawGrid();
    this._drawRiver();
    this._drawFields();
    this._drawPlayers();
  }

  _drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = '#1e2d4a';
    ctx.lineWidth = 1;
    for (let c = 0; c <= 6; c++) {
      const x = PADDING + c * SQUARE_SIZE;
      ctx.beginPath(); ctx.moveTo(x, PADDING); ctx.lineTo(x, CANVAS_SIZE - PADDING); ctx.stroke();
    }
    for (let r = 0; r <= 6; r++) {
      const y = PADDING + r * SQUARE_SIZE;
      ctx.beginPath(); ctx.moveTo(PADDING, y); ctx.lineTo(CANVAS_SIZE - PADDING, y); ctx.stroke();
    }
  }

  _drawRiver() {
    if (!this.map || this.map.length === 0) return;
    const ctx = this.ctx;
    ctx.strokeStyle = RIVER_COLOR;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const p = this.map;
    const n = p.length;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 0; i < n - 1; i++) {
      const p0 = p[Math.max(i - 1, 0)];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[Math.min(i + 2, n - 1)];
      // Catmull-Rom → cubic Bezier (tension 0.5 → factor 1/6)
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.stroke();
  }

  _drawFields() {
    if (!this.map) return;
    const ctx = this.ctx;
    const revealedSquares = this.state ? new Set(this.state.revealedSquares) : null;
    const isOpen = !this.state || this.state.mode === 'open';

    for (const f of this.map) {
      const visible = isOpen || !revealedSquares || revealedSquares.has(f.square_id);
      if (!visible) continue;

      const isRapid = f.rapid_difficulty > 0;
      const r = FIELD_RADIUS;

      // Circle
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isRapid ? RAPID_COLOR : FIELD_COLOR;
      ctx.fill();
      ctx.strokeStyle = isRapid ? '#ff6b6b' : FIELD_STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Field number
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 0.9}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.field_id, f.x, f.y);

      // Icons below the circle
      const icons = [];
      if (f.rapid_difficulty > 0) icons.push(`🌊${f.rapid_difficulty}`);
      if (f.tent_capacity > 0) icons.push(`⛺${f.tent_capacity}`);
      if (f.is_shop) icons.push('🏪');
      if (f.is_fish) icons.push('🐟');
      if (f.is_mushroom) icons.push('🍄');

      if (icons.length) {
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#aaa';
        ctx.fillText(icons.join(' '), f.x, f.y + r + 12);
      }
    }
  }

  _drawPlayers() {
    if (!this.state || !this.state.players) return;
    const ctx = this.ctx;

    // Group players by position to offset them
    const groups = {};
    for (const p of this.state.players) {
      const key = `${p.position}_${p.beforeObstacle ? 'b' : 'a'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }

    for (const [key, players] of Object.entries(groups)) {
      const [posStr, side] = key.split('_');
      const pos = parseInt(posStr);
      if (pos < 0 || pos >= this.map.length) continue;
      const field = this.map[pos];

      // Before-obstacle: offset slightly backward along river
      let baseX = field.x, baseY = field.y;
      if (side === 'b' && pos > 0) {
        const prev = this.map[pos - 1];
        const dx = prev.x - field.x, dy = prev.y - field.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        baseX += dx / len * FIELD_RADIUS * 1.5;
        baseY += dy / len * FIELD_RADIUS * 1.5;
      } else if (side === 'a' && pos < this.map.length - 1) {
        const next = this.map[pos + 1];
        const dx = next.x - field.x, dy = next.y - field.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        baseX += dx / len * FIELD_RADIUS * 1.5;
        baseY += dy / len * FIELD_RADIUS * 1.5;
      }

      const n = players.length;
      players.forEach((p, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const spread = n > 1 ? PIECE_RADIUS * 1.2 : 0;
        const px = baseX + Math.cos(angle) * spread;
        const py = baseY + Math.sin(angle) * spread;

        ctx.beginPath();
        ctx.arc(px, py, PIECE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = p.id === this.myPlayerId ? '#fff' : '#000';
        ctx.lineWidth = p.id === this.myPlayerId ? 2 : 1;
        ctx.stroke();

        // First letter of name
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${PIECE_RADIUS}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.name[0].toUpperCase(), px, py);
      });
    }
  }
}
