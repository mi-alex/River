// UI helpers — resource bars, equipment icons, player list, action buttons, log

function updateResourceBars(player) {
  const set = (id, val, max) => {
    const bar = document.getElementById(`bar-${id}`);
    const label = document.getElementById(`val-${id}`);
    if (bar) bar.style.width = `${(val / max) * 100}%`;
    if (label) label.textContent = `${val}/${max}`;
  };
  set('forces', player.resources.forces, 12);
  set('food', player.resources.food, 12);
  set('skills', player.resources.skills, 12);
  set('money', player.resources.money, 25);
}

function updateEquipment(equipment) {
  const map = { paddle: 'eq-paddle', basket: 'eq-basket', rod: 'eq-rod', vest: 'eq-vest', tent: 'eq-tent', gps: 'eq-gps' };
  for (const [key, elId] of Object.entries(map)) {
    const el = document.getElementById(elId);
    if (el) el.classList.toggle('owned', !!equipment[key]);
  }
}

function updatePlayerList(players, currentPlayerIndex, myPlayerId) {
  const ul = document.getElementById('players-ul');
  ul.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-entry' + (i === currentPlayerIndex ? ' active-player' : '') + (!p.connected ? ' player-offline' : '');
    div.innerHTML = `
      <div class="player-dot" style="background:${p.color}"></div>
      <span class="player-name-text" style="color:${p.color}">${p.name}${p.id === myPlayerId ? ' (вы)' : ''}</span>
      ${p.ready ? '<span class="player-ready-check">✓</span>' : ''}
      ${!p.connected ? '<span title="не в сети">📵</span>' : ''}
    `;
    ul.appendChild(div);
  });
}

function setTurnStatus(text) {
  const el = document.getElementById('turn-status');
  if (el) el.textContent = text;
}

function setActionButtons(buttons) {
  const area = document.getElementById('action-buttons');
  area.innerHTML = '';
  for (const { label, action, primary, disabled } of buttons) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = primary ? 'btn-primary' : 'btn-secondary';
    btn.disabled = !!disabled;
    btn.addEventListener('click', action);
    area.appendChild(btn);
  }
}

function animateDie(elId, value) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.remove('rolling');
  void el.offsetWidth; // reflow
  el.classList.add('rolling');
  el.textContent = value ?? '?';
  setTimeout(() => el.classList.remove('rolling'), 450);
}

function addLog(text) {
  const entries = document.getElementById('log-entries');
  const div = document.createElement('div');
  div.className = 'log-entry';
  div.textContent = text;
  entries.prepend(div);
  // Keep last 50 entries
  while (entries.children.length > 50) entries.lastChild.remove();
}

function showTooltip(field, clientX, clientY) {
  const tt = document.getElementById('board-tooltip');
  if (!field) { tt.style.display = 'none'; return; }
  const lines = [`Поле ${field.field_id}`];
  if (field.rapid_difficulty > 0) lines.push(`Порог: сложность ${field.rapid_difficulty}`);
  if (field.tent_capacity > 0) lines.push(`Палатка: ${field.tent_capacity} чел.`);
  if (field.is_shop) lines.push('🏪 Магазин');
  if (field.is_fish) lines.push('🐟 Рыбалка');
  if (field.is_mushroom) lines.push('🍄 Грибы');
  tt.innerHTML = lines.join('<br>');
  tt.style.display = 'block';
  tt.style.left = (clientX + 12) + 'px';
  tt.style.top = (clientY - 20) + 'px';
}

// Purchase modal helpers
function initPurchaseModal(myMoney, onApply, onReady) {
  const modal = document.getElementById('purchase-modal');
  modal.style.display = 'flex';

  const moneyEl = document.getElementById('pm-money');
  const costEl = document.getElementById('pm-cost');
  const errorEl = document.getElementById('pm-error');

  const COSTS = { paddle: 3, basket: 2, rod: 2, vest: 3, tent: 4, gps: 4 };
  let budget = myMoney;

  function calcCost() {
    const food = parseInt(document.getElementById('pm-food').value) || 0;
    const skills = parseInt(document.getElementById('pm-skills').value) || 0;
    let cost = food + skills * 5;
    document.querySelectorAll('#pm-equipment input:checked').forEach(cb => {
      cost += COSTS[cb.dataset.item] || 0;
    });
    return cost;
  }

  function updateCostDisplay() {
    const cost = calcCost();
    const remain = budget - cost;
    costEl.textContent = `Стоимость: ${cost} монет | Остаток: ${remain}`;
    costEl.style.color = remain < 0 ? 'var(--danger)' : 'var(--accent)';
  }

  modal.querySelectorAll('input').forEach(el => el.addEventListener('input', updateCostDisplay));
  updateCostDisplay();

  document.getElementById('pm-ready').addEventListener('click', () => {
    errorEl.style.display = 'none';
    const food = parseInt(document.getElementById('pm-food').value) || 0;
    const skills = parseInt(document.getElementById('pm-skills').value) || 0;
    const equipment = [...document.querySelectorAll('#pm-equipment input:checked')].map(cb => cb.dataset.item);
    const cost = calcCost();
    if (cost > budget) {
      errorEl.textContent = 'Недостаточно монет для такого набора!';
      errorEl.style.display = 'block';
      return;
    }
    onApply({ food, skills, equipment });
    onReady();
    modal.style.display = 'none';
  });
}

function showPurchaseError(msg) {
  const el = document.getElementById('pm-error');
  el.textContent = msg;
  el.style.display = 'block';
}

// Move step popup
function askSteps(max, onConfirm) {
  const popup = document.getElementById('move-popup');
  const input = document.getElementById('mp-steps');
  const label = document.getElementById('mp-label');
  label.textContent = `Шагов (1–${max}):`;
  input.max = max;
  input.value = max;
  popup.style.display = 'flex';

  const doConfirm = () => {
    const v = parseInt(input.value);
    if (v >= 1 && v <= max) {
      popup.style.display = 'none';
      onConfirm(v);
    }
  };

  document.getElementById('mp-ok').onclick = doConfirm;
  document.getElementById('mp-cancel').onclick = () => { popup.style.display = 'none'; };
}
