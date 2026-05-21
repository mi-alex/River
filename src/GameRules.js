const C = {
  MAX_FORCES: 12, MAX_FOOD: 12, MAX_SKILLS: 12, MAX_MONEY: 25,
  INIT_FORCES: 12, INIT_FOOD: 0, INIT_SKILLS: 0, INIT_MONEY: 25,
  NIGHT_BASE: 1, NIGHT_FOOD_BONUS: 2, NIGHT_TENT_BONUS: 2,
  REST_DAY_BONUS: 5,
  CRASH_FORCE_LOSS: 3,
  FOOD_COST: 1, SKILL_COST: 5,
  EQUIPMENT_COSTS: { paddle: 3, basket: 2, rod: 2, vest: 3, tent: 4, gps: 4 },
};

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rollDie() { return Math.floor(Math.random() * 6) + 1; }

function portrageCost(difficulty) {
  if (difficulty <= 5) return 2;
  if (difficulty <= 8) return 3;
  return 4;
}

function createPlayer(id, name, colorIndex, mode = 'open') {
  const initMoney = mode === 'closed' ? 30 : 25;
  return {
    id,
    name,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    position: 0,
    beforeObstacle: false,
    resources: { forces: C.INIT_FORCES, food: C.INIT_FOOD, skills: C.INIT_SKILLS, money: initMoney },
    moneyMax: initMoney,
    equipment: { paddle: false, basket: false, rod: false, vest: false, tent: false, gps: false },
    ready: false,
    connected: true,
    finished: false,
  };
}

function applyPurchases(player, purchases) {
  const { food = 0, skills = 0, equipment = [] } = purchases;
  let cost = food * C.FOOD_COST + skills * C.SKILL_COST;
  for (const item of equipment) cost += (C.EQUIPMENT_COSTS[item] || 0);

  if (cost > player.resources.money) return { error: 'Недостаточно монет' };
  if (player.resources.food + food > C.MAX_FOOD) return { error: 'Превышен лимит еды' };
  if (player.resources.skills + skills > C.MAX_SKILLS) return { error: 'Превышен лимит навыков' };

  player.resources.money -= cost;
  player.resources.food = clamp(player.resources.food + food, 0, C.MAX_FOOD);
  player.resources.skills = clamp(player.resources.skills + skills, 0, C.MAX_SKILLS);
  for (const item of equipment) {
    if (C.EQUIPMENT_COSTS[item] !== undefined) player.equipment[item] = true;
  }
  return { ok: true };
}

function initTurn(player) {
  return {
    phase: player.beforeObstacle ? 'obstacle_start' : 'pre_move',
    movesLeft: 0,
    paddleAvailable: player.equipment.paddle,
    paddleUsed: false,
    forcesMode: false,
    redDieValue: null,
    blueDieValue: null,
    isRestDay: false,
    fed: false,
    fishAttempted: false,
    forageAttempted: false,
    nightStarted: false,
  };
}

// Returns { newPosition, hitObstacle, hitObstacleAt } after moving `steps` from `startPos`
function simulateMove(startPos, steps, map) {
  let pos = startPos;
  for (let i = 0; i < steps; i++) {
    const nextPos = pos + 1;
    if (nextPos >= map.length) return { newPosition: map.length - 1, hitObstacle: false };
    const field = map[nextPos];
    if (field.rapid_difficulty > 0) {
      return { newPosition: nextPos, hitObstacle: true };
    }
    pos = nextPos;
  }
  return { newPosition: pos, hitObstacle: false };
}

function tentAvailable(player, map, allPlayers) {
  if (player.equipment.tent) return true;
  const field = map[player.position];
  if (field.tent_capacity === 0) return false;
  const occupants = allPlayers.filter(p =>
    p.id !== player.id &&
    p.position === player.position &&
    !p.equipment.tent
  ).length;
  return occupants < field.tent_capacity;
}

function computeNightRecovery(player, map, allPlayers, turn) {
  let recovery = C.NIGHT_BASE;
  if (turn.fed) recovery += C.NIGHT_FOOD_BONUS;
  if (tentAvailable(player, map, allPlayers)) recovery += C.NIGHT_TENT_BONUS;
  return recovery;
}

// Main action processor — returns { ok, error, events[], stateChanges{} }
function processAction(room, playerId, action) {
  const map = room.map;
  const playerIdx = room.players.findIndex(p => p.id === playerId);
  if (playerIdx === -1) return { error: 'Игрок не найден' };
  if (playerIdx !== room.currentPlayerIndex) return { error: 'Сейчас не ваш ход' };

  const player = room.players[playerIdx];
  const turn = room.turn;
  const events = [];

  switch (action.type) {

    case 'rest_day': {
      if (turn.phase !== 'pre_move') return { error: 'Нельзя объявить днёвку сейчас' };
      const gained = clamp(C.REST_DAY_BONUS, 0, C.MAX_FORCES - player.resources.forces);
      player.resources.forces = clamp(player.resources.forces + C.REST_DAY_BONUS, 0, C.MAX_FORCES);
      turn.isRestDay = true;
      turn.phase = 'night';
      events.push({ type: 'rest_day', forcesGained: gained });
      break;
    }

    case 'roll_red': {
      if (turn.phase !== 'pre_move') return { error: 'Нельзя бросить кубик сейчас' };
      const value = rollDie();
      turn.redDieValue = value;
      turn.movesLeft = value;
      turn.paddleAvailable = player.equipment.paddle;
      turn.phase = 'moving';
      events.push({ type: 'die_red', value });
      break;
    }

    case 'use_paddle': {
      if (turn.phase !== 'moving') return { error: 'Нельзя использовать весло сейчас' };
      if (!turn.paddleAvailable) return { error: 'Весло уже использовано или недоступно' };
      turn.movesLeft += 1;
      turn.paddleAvailable = false;
      turn.paddleUsed = true;
      events.push({ type: 'paddle_used' });
      break;
    }

    case 'spend_forces': {
      if (turn.phase !== 'moving') return { error: 'Нельзя тратить силы сейчас' };
      if (turn.movesLeft > 0) return { error: 'Сначала используйте оставшиеся ходы' };
      if (turn.paddleAvailable) return { error: 'Сначала используйте весло' };
      const steps = action.steps || 1;
      if (steps < 1 || steps > player.resources.forces) return { error: 'Недостаточно сил' };
      player.resources.forces -= steps;
      turn.movesLeft += steps;
      turn.forcesMode = true;
      events.push({ type: 'forces_spent', steps });
      break;
    }

    case 'move': {
      if (turn.phase !== 'moving') return { error: 'Нельзя двигаться сейчас' };
      const steps = action.steps || 1;

      // Total available: die budget + optional paddle + remaining forces
      const paddleBonus = turn.paddleAvailable ? 1 : 0;
      const maxSteps = turn.movesLeft + paddleBonus + player.resources.forces;
      if (steps < 1 || steps > maxSteps) return { error: `Недопустимое число шагов (максимум ${maxSteps})` };

      // Consume resources in order: die → paddle → forces
      let fromDie = Math.min(steps, turn.movesLeft);
      turn.movesLeft -= fromDie;
      let stillNeeded = steps - fromDie;

      if (stillNeeded > 0 && turn.paddleAvailable) {
        turn.paddleAvailable = false;
        turn.paddleUsed = true;
        stillNeeded -= 1;
        events.push({ type: 'paddle_used' });
      }

      if (stillNeeded > 0) {
        player.resources.forces -= stillNeeded;
        turn.forcesMode = true;
        events.push({ type: 'forces_spent', steps: stillNeeded });
      }

      // Move — may be stopped early by an obstacle
      const { newPosition, hitObstacle } = simulateMove(player.position, steps, map);
      const stepsActuallyTaken = newPosition - player.position;
      const stepsUnused = steps - stepsActuallyTaken;

      player.position = newPosition;
      turn.movesLeft += stepsUnused; // carry prepaid steps through obstacle
      events.push({ type: 'moved', to: newPosition, steps: stepsActuallyTaken });

      if (newPosition >= map.length - 1) {
        player.finished = true;
        events.push({ type: 'player_finished', playerId });
        if (!room.finishTriggered) {
          room.finishTriggered = true;
          room.finishTriggerPlayerIndex = playerIdx;
        }
        turn.movesLeft = 0;
        turn.paddleAvailable = false;
        turn.phase = 'player_finished'; // skip night
        break;
      }

      if (hitObstacle) {
        player.beforeObstacle = true;
        turn.phase = 'obstacle'; // movesLeft preserved for after obstacle
        events.push({ type: 'obstacle_reached', fieldIndex: newPosition, difficulty: map[newPosition].rapid_difficulty });
      } else if (turn.movesLeft === 0 && !turn.paddleAvailable && player.resources.forces === 0) {
        turn.phase = 'night';
      }
      // else: movesLeft > 0, stay in 'moving'
      break;
    }

    case 'obstacle_stop': {
      if (turn.phase !== 'obstacle' && turn.phase !== 'obstacle_start') return { error: 'Нет препятствия для остановки' };
      if (turn.phase === 'obstacle_start') return { error: 'Нельзя остановиться — надо решить вопрос с препятствием' };
      // Player stops before obstacle (already at it from this turn's movement)
      turn.movesLeft = 0;
      turn.paddleAvailable = false;
      turn.phase = 'night';
      events.push({ type: 'obstacle_stopped' });
      break;
    }

    case 'obstacle_portage': {
      if (turn.phase !== 'obstacle' && turn.phase !== 'obstacle_start') return { error: 'Нет препятствия для обнесения' };
      const field = map[player.position];
      const cost = portrageCost(field.rapid_difficulty);
      if (player.resources.forces < cost) return { error: `Недостаточно сил (нужно ${cost})` };

      player.resources.forces -= cost;
      player.beforeObstacle = false;
      events.push({ type: 'portage', cost, fieldIndex: player.position });

      if (turn.phase === 'obstacle_start') {
        turn.phase = 'pre_move';
      } else {
        const canMove = turn.movesLeft > 0 || turn.paddleAvailable || player.resources.forces > 0;
        turn.phase = canMove ? 'moving' : 'night';
      }
      break;
    }

    case 'obstacle_attempt': {
      if (turn.phase !== 'obstacle' && turn.phase !== 'obstacle_start') return { error: 'Нет препятствия для прохождения' };
      const field = map[player.position];
      const difficulty = field.rapid_difficulty;
      const skills = player.resources.skills;

      let blueDie = null;
      let success = false;
      let skillGained = false;

      if (difficulty <= skills) {
        success = true;
      } else if (difficulty === skills + 1) {
        success = true;
        skillGained = true;
      } else {
        blueDie = rollDie();
        turn.blueDieValue = blueDie;
        success = skills + blueDie >= difficulty;
        if (success) skillGained = true;
      }

      events.push({ type: 'die_blue', value: blueDie });

      if (success) {
        player.beforeObstacle = false;
        if (skillGained) {
          player.resources.skills = clamp(player.resources.skills + 1, 0, C.MAX_SKILLS);
          events.push({ type: 'skill_gained' });
        }
        events.push({ type: 'rapid_passed', fieldIndex: player.position });

        if (turn.phase === 'obstacle_start') {
          turn.phase = 'pre_move';
        } else {
          const canMove = turn.movesLeft > 0 || turn.paddleAvailable || player.resources.forces > 0;
          turn.phase = canMove ? 'moving' : 'night';
        }
      } else {
        // Crash
        if (!player.equipment.vest) {
          const loss = Math.min(C.CRASH_FORCE_LOSS, player.resources.forces);
          player.resources.forces -= loss;
          events.push({ type: 'crash', forcesLost: loss });
        } else {
          events.push({ type: 'crash', forcesLost: 0 });
        }
        // beforeObstacle stays true, player starts next turn at this obstacle
        turn.movesLeft = 0;
        turn.paddleAvailable = false;
        turn.phase = 'night';
      }
      break;
    }

    case 'end_move': {
      if (turn.phase !== 'moving') return { error: 'Нельзя завершить движение сейчас' };
      turn.movesLeft = 0;
      turn.paddleAvailable = false;
      turn.phase = 'night';
      events.push({ type: 'move_ended' });
      break;
    }

    case 'night_eat_stock': {
      if (turn.phase !== 'night') return { error: 'Сейчас не ночной отдых' };
      if (turn.fed) return { error: 'Вы уже поели' };
      if (player.resources.food < 1) return { error: 'Нет запасов еды' };
      player.resources.food -= 1;
      turn.fed = true;
      events.push({ type: 'ate', source: 'stock' });
      break;
    }

    case 'night_fish': {
      if (turn.phase !== 'night') return { error: 'Сейчас не ночной отдых' };
      if (turn.fed) return { error: 'Вы уже поели' };
      if (turn.fishAttempted) return { error: 'Вы уже пробовали рыбачить в этот ход' };
      if (!player.equipment.rod) return { error: 'Нет удочки' };
      const field = map[player.position];
      if (!field.is_fish) return { error: 'На этой клетке нет рыбалки' };
      const die = rollDie();
      turn.blueDieValue = die;
      const caught = die >= 4;
      turn.fishAttempted = true;
      if (caught) turn.fed = true;
      events.push({ type: 'die_blue', value: die });
      events.push({ type: 'fish_attempt', success: caught });
      break;
    }

    case 'night_forage': {
      if (turn.phase !== 'night') return { error: 'Сейчас не ночной отдых' };
      if (turn.fed) return { error: 'Вы уже поели' };
      if (turn.forageAttempted) return { error: 'Вы уже пробовали собирать грибы в этот ход' };
      if (!player.equipment.basket) return { error: 'Нет корзинки' };
      const field = map[player.position];
      if (!field.is_mushroom) return { error: 'На этой клетке нет грибов' };
      const die = rollDie();
      turn.blueDieValue = die;
      const found = die >= 4;
      turn.forageAttempted = true;
      if (found) turn.fed = true;
      events.push({ type: 'die_blue', value: die });
      events.push({ type: 'forage_attempt', success: found });
      break;
    }

    case 'night_buy_food': {
      if (turn.phase !== 'night') return { error: 'Сейчас не ночной отдых' };
      const field = map[player.position];
      if (!field.is_shop) return { error: 'На этой клетке нет магазина' };
      const amount = action.amount || 1;
      if (amount < 1) return { error: 'Неверное количество' };
      const cost = amount * C.FOOD_COST;
      if (cost > player.resources.money) return { error: 'Недостаточно монет' };
      if (player.resources.food + amount > C.MAX_FOOD) return { error: 'Превышен лимит еды' };
      player.resources.money -= cost;
      player.resources.food = clamp(player.resources.food + amount, 0, C.MAX_FOOD);
      events.push({ type: 'food_bought', amount, cost });
      break;
    }

    case 'end_turn': {
      if (turn.phase !== 'player_finished') return { error: 'Нельзя закончить ход сейчас' };
      turn.phase = 'done';
      break;
    }

    case 'end_night': {
      if (turn.phase !== 'night') return { error: 'Сейчас не ночной отдых' };
      const recovery = computeNightRecovery(player, map, room.players, turn);
      player.resources.forces = clamp(player.resources.forces + recovery, 0, C.MAX_FORCES);
      events.push({ type: 'night_rest', recovery, fed: turn.fed });
      turn.phase = 'done';
      break;
    }

    default:
      return { error: `Неизвестное действие: ${action.type}` };
  }

  return { ok: true, events };
}

function computeResults(players) {
  const sorted = [...players].sort((a, b) => {
    if (b.position !== a.position) return b.position - a.position;
    if (b.resources.skills !== a.resources.skills) return b.resources.skills - a.resources.skills;
    return b.resources.money - a.resources.money;
  });
  return sorted.map((p, i) => ({
    playerId: p.id,
    name: p.name,
    place: i + 1,
    position: p.position,
    finished: p.finished,
    skills: p.resources.skills,
    money: p.resources.money,
  }));
}

module.exports = { createPlayer, applyPurchases, initTurn, processAction, computeResults, PLAYER_COLORS, C };
