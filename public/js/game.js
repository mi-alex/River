// Main game client — connects to server, drives UI and board

const socket = io();
const params = new URLSearchParams(location.search);
const roomId = params.get('room') || sessionStorage.getItem('roomId');
const playerName = sessionStorage.getItem('playerName');

if (!roomId) { location.href = '/'; }
if (!playerName) { location.href = `/?room=${roomId}`; }

let myPlayerId = null;
let gameMap = null;
let gameState = null;
let board = null;
let purchaseDone = false;
let purchaseModalOpen = false;

// ——— Init board renderer ———
window.addEventListener('DOMContentLoaded', () => {
  board = new BoardRenderer(document.getElementById('board-canvas'));
  board.onFieldHover = (field, x, y) => showTooltip(field, x, y);

  document.getElementById('my-name').textContent = playerName;

  socket.emit('join_room', { roomId, playerName });
});

socket.on('joined', ({ playerId, map }) => {
  myPlayerId = playerId;
  gameMap = map;
  board.setMap(map);
  board.myPlayerId = playerId;
});

socket.on('state', state => {
  gameState = state;
  board.setState(state);
  renderUI(state);
});

socket.on('events', ({ events, playerId }) => {
  for (const ev of events) handleEvent(ev, playerId);
});

socket.on('error', ({ message }) => {
  addLog('⚠️ ' + message);
  alert(message);
});

// ——— Event log ———
function handleEvent(ev, fromPlayerId) {
  const name = gameState?.players.find(p => p.id === fromPlayerId)?.name || '?';
  const msgs = {
    'die_red': () => `${name}: красный кубик — ${ev.value}`,
    'die_blue': () => ev.value != null ? `${name}: синий кубик — ${ev.value}` : null,
    'moved': () => `${name}: прошёл на ${ev.steps} шаг(а/ов) → поле ${ev.to + 1}`,
    'portage': () => `${name}: обнёс порог (−${ev.cost} сил)`,
    'rapid_passed': () => `${name}: прошёл порог!`,
    'skill_gained': () => `${name}: +1 навык`,
    'crash': () => ev.forcesLost > 0 ? `${name}: КРУШЕНИЕ (−${ev.forcesLost} сил)` : `${name}: КРУШЕНИЕ (жилет спас)`,
    'rest_day': () => `${name}: днёвка (+${ev.forcesGained} сил)`,
    'night_rest': () => `${name}: ночёвка +${ev.recovery} сил`,
    'ate': () => `${name}: поел(-а)`,
    'fish_attempt': () => ev.success ? `${name}: поймал рыбу!` : `${name}: рыба не клюёт`,
    'forage_attempt': () => ev.success ? `${name}: нашёл грибы!` : `${name}: грибов нет`,
    'food_bought': () => `${name}: купил ${ev.amount} ед. еды`,
    'player_finished': () => `🏁 ${name} добрался до финиша!`,
    'obstacle_stopped': () => `${name}: остановился перед порогом`,
    'paddle_used': () => `${name}: использовал весло (+1 шаг)`,
    'forces_spent': () => `${name}: потратил ${ev.steps} сил`,
  };
  const fn = msgs[ev.type];
  if (fn) {
    const msg = fn();
    if (msg) addLog(msg);
  }

  // Animate dice
  if (ev.type === 'die_red') animateDie('die-red', ev.value);
  if (ev.type === 'die_blue' && ev.value != null) animateDie('die-blue', ev.value);
}

// ——— Main UI renderer ———
function renderUI(state) {
  document.getElementById('round-display').textContent = `Круг ${state.round}`;

  const me = state.players.find(p => p.id === myPlayerId);
  if (me) {
    updateResourceBars(me);
    updateEquipment(me.equipment);
  }

  updatePlayerList(state.players, state.currentPlayerIndex, myPlayerId);

  const currentPlayer = state.players[state.currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === myPlayerId;

  if (state.phase === 'pre_game') {
    renderPreGame(state, me);
  } else if (state.phase === 'playing') {
    renderPlayingPhase(state, me, currentPlayer, isMyTurn);
  } else if (state.phase === 'finished') {
    renderFinished(state);
  }
}

function renderPreGame(state, me) {
  const inviteUrl = `${location.origin}/game.html?room=${roomId}`;
  setTurnStatus(`Ссылка для друзей: ${inviteUrl}`);

  if (!purchaseDone && !purchaseModalOpen && me) {
    purchaseModalOpen = true;
    initPurchaseModal(
      me.resources.money,
      purchases => {
        socket.emit('purchase', purchases);
      },
      () => {
        socket.emit('mark_ready');
        purchaseDone = true;
        purchaseModalOpen = false;
      },
      state.mode
    );
  }

  const allReady = state.players.every(p => p.ready);
  setTurnStatus(allReady ? 'Все готовы, ждём первый ход...' : 'Ждём, пока все будут готовы');
  setActionButtons([]);
}

function renderPlayingPhase(state, me, currentPlayer, isMyTurn) {
  const turn = state.turn;
  if (!turn || !currentPlayer) return;

  if (!isMyTurn) {
    setTurnStatus(`Ход: ${currentPlayer.name}`);
    setActionButtons([]);
    document.getElementById('finish-popup').style.display = 'none';
    return;
  }

  // It's my turn
  const field = gameMap ? gameMap[me.position] : null;
  const buttons = [];

  switch (turn.phase) {
    case 'obstacle_start': {
      const difficulty = field?.rapid_difficulty || 0;
      const portCost = difficulty <= 5 ? 2 : difficulty <= 8 ? 3 : 4;
      setTurnStatus(`Порог сложности ${difficulty}. Ваши действия:`);
      buttons.push({
        label: `Обнести (−${portCost} сил)`,
        primary: false,
        disabled: me.resources.forces < portCost,
        action: () => send('obstacle_portage'),
      });
      buttons.push({
        label: 'Пройти своим ходом',
        primary: true,
        action: () => send('obstacle_attempt'),
      });
      break;
    }

    case 'pre_move': {
      setTurnStatus('Ваш ход');
      buttons.push({ label: 'Бросить кубик 🎲', primary: true, action: () => send('roll_red') });
      buttons.push({ label: 'Объявить днёвку', primary: false, action: () => send('rest_day') });
      break;
    }

    case 'moving': {
      const { movesLeft, paddleAvailable } = turn;
      const maxSteps = movesLeft + (paddleAvailable ? 1 : 0) + me.resources.forces;

      const parts = [];
      if (movesLeft > 0) parts.push(`${movesLeft} от кубика`);
      if (paddleAvailable) parts.push('весло');
      if (me.resources.forces > 0) parts.push(`${me.resources.forces} сил`);
      setTurnStatus(`Запас хода: ${parts.join(' + ') || '0'}`);

      if (maxSteps > 0) {
        buttons.push({
          label: 'Идти вперёд',
          primary: true,
          action: () => {
            const finishDist = gameMap.length - 1 - me.position;
            const rawRapid = distToNearestRapid(me.position);
            // Rapid only matters if it comes before the finish
            const rapidDist = rawRapid !== null && rawRapid < finishDist ? rawRapid : null;

            let stopDist = null;
            let stopLabel = null;
            if (rapidDist !== null && rapidDist < maxSteps) {
              stopDist = rapidDist;
              stopLabel = `До ближайшего порога: ${rapidDist}`;
            } else if (finishDist <= maxSteps) {
              stopDist = finishDist;
              stopLabel = `До финиша: ${finishDist}`;
            }

            askSteps(maxSteps, stopDist, stopLabel, steps => send('move', { steps }));
          },
        });
      }
      buttons.push({ label: 'Закончить движение', primary: false, action: () => send('end_move') });
      break;
    }

    case 'player_finished': {
      setTurnStatus('🏁 Вы достигли финиша!');
      const fp = document.getElementById('finish-popup');
      fp.style.display = 'flex';
      document.getElementById('fp-ok').onclick = () => {
        fp.style.display = 'none';
        send('end_turn');
      };
      setActionButtons([]);
      break;
    }

    case 'obstacle': {
      const difficulty = field?.rapid_difficulty || 0;
      const portCost = difficulty <= 5 ? 2 : difficulty <= 8 ? 3 : 4;
      setTurnStatus(`Порог сложности ${difficulty}`);
      buttons.push({
        label: 'Остановиться',
        primary: false,
        action: () => send('obstacle_stop'),
      });
      buttons.push({
        label: `Обнести (−${portCost} сил)`,
        primary: false,
        disabled: me.resources.forces < portCost,
        action: () => send('obstacle_portage'),
      });
      buttons.push({
        label: 'Пройти своим ходом',
        primary: true,
        action: () => send('obstacle_attempt'),
      });
      break;
    }

    case 'night': {
      setTurnStatus('Ночёвка');
      const fed = turn.fed;
      if (!fed) {
        if (me.resources.food > 0) {
          buttons.push({ label: `Поесть из запасов 🍲`, primary: false, action: () => send('night_eat_stock') });
        }
        if (me.equipment.rod && field?.is_fish && !turn.fishAttempted) {
          buttons.push({ label: 'Порыбачить 🎣', primary: false, action: () => send('night_fish') });
        }
        if (me.equipment.basket && field?.is_mushroom && !turn.forageAttempted) {
          buttons.push({ label: 'Собрать грибы 🍄', primary: false, action: () => send('night_forage') });
        }
      }
      if (field?.is_shop && me.resources.money > 0) {
        buttons.push({
          label: `Сходить в магазин 🪙`,
          primary: false,
          action: () => {
            const max = Math.min(me.resources.money, 12 - me.resources.food);
            if (max <= 0) { addLog('Нельзя купить: еда заполнена'); return; }
            askSteps(max, null, null, amount => send('night_buy_food', { amount }), `Купить еду (1–${max} ед.)`);
          },
        });
      }
      buttons.push({ label: 'Пойти спать', primary: true, action: () => send('end_night') });
      break;
    }
  }

  setActionButtons(buttons);
}

function renderFinished(state) {
  document.getElementById('finish-popup').style.display = 'none';
  setTurnStatus('Игра завершена!');
  const results = state.results || [];
  const lines = results.map((r, i) => {
    const pos = r.finished ? '🏁 финиш' : `поле ${r.position + 1}`;
    return `${i + 1}. ${r.name} — ${pos}, навыки: ${r.skills}, монеты: ${r.money}`;
  });
  setActionButtons([]);
  document.getElementById('action-area').innerHTML = `
    <div style="font-size:1rem;color:var(--accent);margin-bottom:0.5rem">Итоги</div>
    ${lines.map(l => `<div style="font-size:0.85rem;margin:4px 0">${l}</div>`).join('')}
  `;
}

function send(type, extra = {}) {
  socket.emit('action', { type, ...extra });
}

// Returns steps to the nearest rapid ahead of fromPos, or null if none
function distToNearestRapid(fromPos) {
  if (!gameMap) return null;
  for (let i = fromPos + 1; i < gameMap.length; i++) {
    if (gameMap[i].rapid_difficulty > 0) return i - fromPos;
  }
  return null;
}
