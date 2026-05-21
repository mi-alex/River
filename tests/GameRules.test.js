const { createPlayer, applyPurchases, initTurn, processAction, computeResults, C } = require('../src/GameRules');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeField(overrides = {}) {
  return { rapid_difficulty: 0, is_fish: false, is_mushroom: false, is_shop: false, tent_capacity: 0, square_id: 1, ...overrides };
}

function makeMap(length = 10) {
  return Array.from({ length }, () => makeField());
}

function makeRoom(playerOverrides = {}, turnOverrides = {}, mapOverride = null) {
  const map = mapOverride || makeMap();
  const player = Object.assign(createPlayer('p1', 'Alice', 0, 'open'), playerOverrides);
  const turn = Object.assign(initTurn(player), turnOverrides);
  return { map, players: [player], currentPlayerIndex: 0, turn, finishTriggered: false, finishTriggerPlayerIndex: null };
}

// ─── createPlayer ─────────────────────────────────────────────────────────────

describe('createPlayer', () => {
  test('initial resources in open mode', () => {
    const p = createPlayer('id1', 'Bob', 0, 'open');
    expect(p.resources).toEqual({ forces: 12, food: 0, skills: 0, money: 25 });
  });

  test('initial resources in closed mode give more money', () => {
    const p = createPlayer('id1', 'Bob', 0, 'closed');
    expect(p.resources.money).toBe(30);
  });

  test('initial state flags', () => {
    const p = createPlayer('id1', 'Bob', 0, 'open');
    expect(p.position).toBe(0);
    expect(p.finished).toBe(false);
    expect(p.ready).toBe(false);
    expect(p.connected).toBe(true);
    expect(p.beforeObstacle).toBe(false);
    expect(Object.values(p.equipment).every(v => v === false)).toBe(true);
  });

  test('color index wraps around', () => {
    const p0 = createPlayer('id1', 'Bob', 0);
    const p6 = createPlayer('id1', 'Bob', 6);
    expect(p0.color).toBe(p6.color);
  });
});

// ─── applyPurchases ───────────────────────────────────────────────────────────

describe('applyPurchases', () => {
  function fresh() { return createPlayer('id1', 'Alice', 0, 'open'); }

  test('buy food deducts money and adds food', () => {
    const p = fresh();
    expect(applyPurchases(p, { food: 3 })).toEqual({ ok: true });
    expect(p.resources.food).toBe(3);
    expect(p.resources.money).toBe(22);
  });

  test('buy skills deducts 5 money per skill', () => {
    const p = fresh();
    expect(applyPurchases(p, { skills: 2 })).toEqual({ ok: true });
    expect(p.resources.skills).toBe(2);
    expect(p.resources.money).toBe(15);
  });

  test('buy equipment sets flag and deducts cost', () => {
    const p = fresh();
    expect(applyPurchases(p, { equipment: ['paddle', 'rod'] })).toEqual({ ok: true });
    expect(p.equipment.paddle).toBe(true);
    expect(p.equipment.rod).toBe(true);
    expect(p.resources.money).toBe(20); // 25 - 3 - 2
  });

  test('combined purchase deducts total cost', () => {
    const p = fresh(); // 25 money: paddle(3)+rod(2)+food(5)*1+skills(3)*5 = 25
    expect(applyPurchases(p, { food: 5, skills: 3, equipment: ['paddle', 'rod'] })).toEqual({ ok: true });
    expect(p.resources.money).toBe(0);
  });

  test('error when not enough money — state unchanged', () => {
    const p = fresh();
    p.resources.money = 1;
    const result = applyPurchases(p, { food: 5 });
    expect(result.error).toBeDefined();
    expect(p.resources.food).toBe(0);
  });

  test('error when food would exceed max', () => {
    const p = fresh();
    p.resources.food = 10;
    expect(applyPurchases(p, { food: 5 }).error).toBeDefined();
  });

  test('error when skills would exceed max', () => {
    const p = fresh();
    p.resources.skills = 10;
    expect(applyPurchases(p, { skills: 5 }).error).toBeDefined();
  });
});

// ─── computeResults ───────────────────────────────────────────────────────────

describe('computeResults', () => {
  function player(id, pos, skills, money) {
    return { id, name: id, position: pos, finished: false, resources: { skills, money } };
  }

  test('sorts by position descending', () => {
    const results = computeResults([player('a', 3, 0, 0), player('b', 7, 0, 0), player('c', 1, 0, 0)]);
    expect(results.map(r => r.playerId)).toEqual(['b', 'a', 'c']);
    expect(results[0].place).toBe(1);
  });

  test('position tie broken by skills', () => {
    const results = computeResults([player('a', 5, 2, 10), player('b', 5, 5, 5)]);
    expect(results[0].playerId).toBe('b');
  });

  test('position and skills tie broken by money', () => {
    const results = computeResults([player('a', 5, 3, 8), player('b', 5, 3, 15)]);
    expect(results[0].playerId).toBe('b');
  });
});

// ─── processAction: rest_day ──────────────────────────────────────────────────

describe('processAction: rest_day', () => {
  test('gains forces and transitions to night', () => {
    const room = makeRoom({ resources: { forces: 5, food: 0, skills: 0, money: 25 } }, { phase: 'pre_move' });
    const result = processAction(room, 'p1', { type: 'rest_day' });
    expect(result.ok).toBe(true);
    expect(room.players[0].resources.forces).toBe(10);
    expect(room.turn.phase).toBe('night');
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'rest_day' }));
  });

  test('forces do not exceed MAX_FORCES', () => {
    const room = makeRoom({ resources: { forces: 10, food: 0, skills: 0, money: 25 } }, { phase: 'pre_move' });
    processAction(room, 'p1', { type: 'rest_day' });
    expect(room.players[0].resources.forces).toBe(C.MAX_FORCES);
  });

  test('error when not in pre_move phase', () => {
    const room = makeRoom({}, { phase: 'night' });
    expect(processAction(room, 'p1', { type: 'rest_day' }).error).toBeDefined();
  });
});

// ─── processAction: roll_red ──────────────────────────────────────────────────

describe('processAction: roll_red', () => {
  test('sets movesLeft to die value and phase to moving', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // floor(0.5*6)+1 = 4
    const room = makeRoom({}, { phase: 'pre_move' });
    const result = processAction(room, 'p1', { type: 'roll_red' });
    expect(result.ok).toBe(true);
    expect(room.turn.redDieValue).toBe(4);
    expect(room.turn.movesLeft).toBe(4);
    expect(room.turn.phase).toBe('moving');
    jest.restoreAllMocks();
  });

  test('error when not in pre_move phase', () => {
    const room = makeRoom({}, { phase: 'moving' });
    expect(processAction(room, 'p1', { type: 'roll_red' }).error).toBeDefined();
  });
});

// ─── processAction: use_paddle ────────────────────────────────────────────────

describe('processAction: use_paddle', () => {
  test('adds 1 to movesLeft and marks paddle used', () => {
    const room = makeRoom(
      { equipment: { paddle: true, basket: false, rod: false, vest: false, tent: false, gps: false } },
      { phase: 'moving', movesLeft: 2, paddleAvailable: true }
    );
    const result = processAction(room, 'p1', { type: 'use_paddle' });
    expect(result.ok).toBe(true);
    expect(room.turn.movesLeft).toBe(3);
    expect(room.turn.paddleAvailable).toBe(false);
    expect(room.turn.paddleUsed).toBe(true);
  });

  test('error when paddle not available', () => {
    const room = makeRoom({}, { phase: 'moving', movesLeft: 2, paddleAvailable: false });
    expect(processAction(room, 'p1', { type: 'use_paddle' }).error).toBeDefined();
  });
});

// ─── processAction: move ──────────────────────────────────────────────────────

describe('processAction: move', () => {
  test('moves player forward by steps', () => {
    const room = makeRoom({ position: 0 }, { phase: 'moving', movesLeft: 3, paddleAvailable: false });
    const result = processAction(room, 'p1', { type: 'move', steps: 3 });
    expect(result.ok).toBe(true);
    expect(room.players[0].position).toBe(3);
  });

  test('stops at obstacle and sets obstacle phase', () => {
    const map = makeMap(10);
    map[2] = makeField({ rapid_difficulty: 4 });
    const room = makeRoom({ position: 0 }, { phase: 'moving', movesLeft: 5, paddleAvailable: false }, map);
    processAction(room, 'p1', { type: 'move', steps: 5 });
    expect(room.players[0].position).toBe(2);
    expect(room.turn.phase).toBe('obstacle');
    expect(room.players[0].beforeObstacle).toBe(true);
  });

  test('player finishes when reaching last cell', () => {
    const map = makeMap(5); // positions 0-4
    const room = makeRoom({ position: 3 }, { phase: 'moving', movesLeft: 5, paddleAvailable: false }, map);
    processAction(room, 'p1', { type: 'move', steps: 5 });
    expect(room.players[0].finished).toBe(true);
    expect(room.players[0].position).toBe(4);
    expect(room.turn.phase).toBe('player_finished');
  });

  test('phase becomes night when all moves exhausted', () => {
    const room = makeRoom(
      { resources: { forces: 0, food: 0, skills: 0, money: 25 } },
      { phase: 'moving', movesLeft: 2, paddleAvailable: false }
    );
    processAction(room, 'p1', { type: 'move', steps: 2 });
    expect(room.turn.phase).toBe('night');
  });

  test('error when requested steps exceed available', () => {
    const room = makeRoom(
      { resources: { forces: 0, food: 0, skills: 0, money: 25 } },
      { phase: 'moving', movesLeft: 0, paddleAvailable: false }
    );
    expect(processAction(room, 'p1', { type: 'move', steps: 1 }).error).toBeDefined();
  });
});

// ─── processAction: end_move ──────────────────────────────────────────────────

describe('processAction: end_move', () => {
  test('transitions phase to night', () => {
    const room = makeRoom({}, { phase: 'moving', movesLeft: 1, paddleAvailable: false });
    const result = processAction(room, 'p1', { type: 'end_move' });
    expect(result.ok).toBe(true);
    expect(room.turn.phase).toBe('night');
  });
});

// ─── processAction: obstacle_portage ─────────────────────────────────────────

describe('processAction: obstacle_portage', () => {
  test('deducts forces and clears beforeObstacle', () => {
    const map = makeMap(10);
    map[2] = makeField({ rapid_difficulty: 4 }); // portage cost = 2
    const room = makeRoom(
      { position: 2, beforeObstacle: true, resources: { forces: 2, food: 0, skills: 0, money: 25 } },
      { phase: 'obstacle', movesLeft: 0, paddleAvailable: false },
      map
    );
    const result = processAction(room, 'p1', { type: 'obstacle_portage' });
    expect(result.ok).toBe(true);
    expect(room.players[0].resources.forces).toBe(0);
    expect(room.players[0].beforeObstacle).toBe(false);
    expect(room.turn.phase).toBe('night');
  });

  test('error when not enough forces for portage', () => {
    const map = makeMap(10);
    map[2] = makeField({ rapid_difficulty: 9 }); // portage cost = 4
    const room = makeRoom(
      { position: 2, beforeObstacle: true, resources: { forces: 2, food: 0, skills: 0, money: 25 } },
      { phase: 'obstacle', movesLeft: 0, paddleAvailable: false },
      map
    );
    expect(processAction(room, 'p1', { type: 'obstacle_portage' }).error).toBeDefined();
  });
});

// ─── processAction: obstacle_attempt ─────────────────────────────────────────

describe('processAction: obstacle_attempt', () => {
  test('auto-success when skills >= difficulty', () => {
    const map = makeMap(10);
    map[3] = makeField({ rapid_difficulty: 3 });
    const room = makeRoom(
      { position: 3, beforeObstacle: true, resources: { forces: 8, food: 0, skills: 3, money: 25 } },
      { phase: 'obstacle', movesLeft: 0, paddleAvailable: false },
      map
    );
    const result = processAction(room, 'p1', { type: 'obstacle_attempt' });
    expect(result.ok).toBe(true);
    expect(room.players[0].beforeObstacle).toBe(false);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'rapid_passed' }));
  });

  test('auto-success with skill gain when difficulty === skills + 1', () => {
    const map = makeMap(10);
    map[3] = makeField({ rapid_difficulty: 4 });
    const room = makeRoom(
      { position: 3, beforeObstacle: true, resources: { forces: 8, food: 0, skills: 3, money: 25 } },
      { phase: 'obstacle', movesLeft: 0, paddleAvailable: false },
      map
    );
    const result = processAction(room, 'p1', { type: 'obstacle_attempt' });
    expect(result.ok).toBe(true);
    expect(room.players[0].resources.skills).toBe(4);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'skill_gained' }));
  });

  test('crash deducts forces when no vest', () => {
    const map = makeMap(10);
    map[3] = makeField({ rapid_difficulty: 10 });
    jest.spyOn(Math, 'random').mockReturnValue(0); // die = 1, skills=0 → 0+1 < 10 → fail
    const room = makeRoom(
      { position: 3, beforeObstacle: true, resources: { forces: 8, food: 0, skills: 0, money: 25 } },
      { phase: 'obstacle', movesLeft: 0, paddleAvailable: false },
      map
    );
    const result = processAction(room, 'p1', { type: 'obstacle_attempt' });
    expect(result.ok).toBe(true);
    expect(room.players[0].resources.forces).toBe(5); // 8 - 3
    expect(room.turn.phase).toBe('night');
    jest.restoreAllMocks();
  });

  test('crash with vest loses no forces', () => {
    const map = makeMap(10);
    map[3] = makeField({ rapid_difficulty: 10 });
    jest.spyOn(Math, 'random').mockReturnValue(0); // die = 1 → fail
    const room = makeRoom(
      {
        position: 3, beforeObstacle: true,
        resources: { forces: 8, food: 0, skills: 0, money: 25 },
        equipment: { paddle: false, basket: false, rod: false, vest: true, tent: false, gps: false },
      },
      { phase: 'obstacle', movesLeft: 0, paddleAvailable: false },
      map
    );
    processAction(room, 'p1', { type: 'obstacle_attempt' });
    expect(room.players[0].resources.forces).toBe(8);
    jest.restoreAllMocks();
  });
});

// ─── processAction: night actions ────────────────────────────────────────────

describe('processAction: night actions', () => {
  test('night_eat_stock reduces food and marks fed', () => {
    const room = makeRoom({ resources: { forces: 5, food: 3, skills: 0, money: 25 } }, { phase: 'night' });
    const result = processAction(room, 'p1', { type: 'night_eat_stock' });
    expect(result.ok).toBe(true);
    expect(room.players[0].resources.food).toBe(2);
    expect(room.turn.fed).toBe(true);
  });

  test('night_eat_stock error when already fed', () => {
    const room = makeRoom({}, { phase: 'night', fed: true });
    expect(processAction(room, 'p1', { type: 'night_eat_stock' }).error).toBeDefined();
  });

  test('night_eat_stock error when no food', () => {
    const room = makeRoom({ resources: { forces: 5, food: 0, skills: 0, money: 25 } }, { phase: 'night' });
    expect(processAction(room, 'p1', { type: 'night_eat_stock' }).error).toBeDefined();
  });

  test('end_night recovers base forces only (no food, no tent)', () => {
    const room = makeRoom({ resources: { forces: 5, food: 0, skills: 0, money: 25 } }, { phase: 'night', fed: false });
    processAction(room, 'p1', { type: 'end_night' });
    expect(room.players[0].resources.forces).toBe(6); // +1 base
    expect(room.turn.phase).toBe('done');
  });

  test('end_night recovers more forces when fed', () => {
    const room = makeRoom({ resources: { forces: 5, food: 0, skills: 0, money: 25 } }, { phase: 'night', fed: true });
    processAction(room, 'p1', { type: 'end_night' });
    expect(room.players[0].resources.forces).toBe(8); // +1 base +2 food
  });

  test('end_night recovers more forces with tent', () => {
    const map = makeMap(10);
    map[0] = makeField({ tent_capacity: 2 }); // field tent available
    const room = makeRoom({ resources: { forces: 5, food: 0, skills: 0, money: 25 } }, { phase: 'night', fed: false }, map);
    processAction(room, 'p1', { type: 'end_night' });
    expect(room.players[0].resources.forces).toBe(8); // +1 base +2 tent
  });

  test('end_night forces do not exceed MAX_FORCES', () => {
    const room = makeRoom({ resources: { forces: 12, food: 0, skills: 0, money: 25 } }, { phase: 'night', fed: true });
    processAction(room, 'p1', { type: 'end_night' });
    expect(room.players[0].resources.forces).toBe(C.MAX_FORCES);
  });

  test('night_buy_food at shop field', () => {
    const map = makeMap(10);
    map[0] = makeField({ is_shop: true });
    const room = makeRoom(
      { position: 0, resources: { forces: 5, food: 0, skills: 0, money: 10 } },
      { phase: 'night' },
      map
    );
    const result = processAction(room, 'p1', { type: 'night_buy_food', amount: 3 });
    expect(result.ok).toBe(true);
    expect(room.players[0].resources.food).toBe(3);
    expect(room.players[0].resources.money).toBe(7);
  });

  test('night_buy_food error when not at shop', () => {
    const room = makeRoom({}, { phase: 'night' });
    expect(processAction(room, 'p1', { type: 'night_buy_food', amount: 1 }).error).toBeDefined();
  });
});

// ─── processAction: general error cases ──────────────────────────────────────

describe('processAction: error cases', () => {
  test('error when wrong player acts', () => {
    const room = makeRoom({}, { phase: 'pre_move' });
    expect(processAction(room, 'wrong_id', { type: 'roll_red' }).error).toBeDefined();
  });

  test('error on unknown action type', () => {
    const room = makeRoom({}, { phase: 'pre_move' });
    expect(processAction(room, 'p1', { type: 'teleport' }).error).toBeDefined();
  });
});
