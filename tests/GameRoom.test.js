const GameRoom = require('../src/GameRoom');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMap(length = 10) {
  return Array.from({ length }, (_, i) => ({
    rapid_difficulty: 0, is_fish: false, is_mushroom: false,
    is_shop: false, tent_capacity: 0, square_id: Math.ceil((i + 1) / 3),
  }));
}

const MAP = makeMap();

function startedRoom() {
  const room = new GameRoom('room1', 'p1', 'open', MAP);
  room.addPlayer('p1', 'Alice');
  room.addPlayer('p2', 'Bob');
  room.markReady('p1');
  room.markReady('p2');
  return room;
}

// ─── addPlayer ────────────────────────────────────────────────────────────────

describe('GameRoom.addPlayer', () => {
  test('first player transitions room to pre_game', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    const result = room.addPlayer('p1', 'Alice');
    expect(result.ok).toBe(true);
    expect(room.phase).toBe('pre_game');
    expect(room.players).toHaveLength(1);
  });

  test('subsequent players are added without changing phase', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    room.addPlayer('p2', 'Bob');
    expect(room.players).toHaveLength(2);
    expect(room.phase).toBe('pre_game');
  });

  test('error on duplicate name', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    expect(room.addPlayer('p2', 'Alice').error).toBeDefined();
  });

  test('error when room is full (6 players)', () => {
    const room = new GameRoom('room1', 'p0', 'open', MAP);
    for (let i = 0; i < 6; i++) room.addPlayer(`p${i}`, `Player${i}`);
    expect(room.addPlayer('p7', 'Extra').error).toBeDefined();
  });
});

// ─── markReady ────────────────────────────────────────────────────────────────

describe('GameRoom.markReady', () => {
  test('game starts when all players mark ready (>= 2)', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    room.addPlayer('p2', 'Bob');
    room.markReady('p1');
    const result = room.markReady('p2');
    expect(result.allReady).toBe(true);
    expect(room.phase).toBe('playing');
    expect(room.turn).not.toBeNull();
  });

  test('game does not start with only one player ready', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    const result = room.markReady('p1');
    expect(result.allReady).toBe(false);
    expect(room.phase).toBe('pre_game');
  });
});

// ─── purchase ─────────────────────────────────────────────────────────────────

describe('GameRoom.purchase', () => {
  test('player can buy food in pre_game', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    const result = room.purchase('p1', { food: 2 });
    expect(result.ok).toBe(true);
    expect(room.players[0].resources.food).toBe(2);
  });

  test('error when player has already marked ready', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    room.markReady('p1');
    expect(room.purchase('p1', { food: 1 }).error).toBeDefined();
  });

  test('error when game is already playing', () => {
    const room = startedRoom();
    expect(room.purchase('p1', { food: 1 }).error).toBeDefined();
  });
});

// ─── turn advancement ─────────────────────────────────────────────────────────

describe('GameRoom turn advancement', () => {
  test('advances to next player after end_night', () => {
    const room = startedRoom();
    expect(room.currentPlayerIndex).toBe(0);
    room.action('p1', { type: 'rest_day' });
    room.action('p1', { type: 'end_night' });
    expect(room.currentPlayerIndex).toBe(1);
  });

  test('round counter increments after all players take a turn', () => {
    const room = startedRoom();
    expect(room.round).toBe(1);
    room.action('p1', { type: 'rest_day' });
    room.action('p1', { type: 'end_night' });
    room.action('p2', { type: 'rest_day' });
    room.action('p2', { type: 'end_night' });
    expect(room.round).toBe(2);
  });

  test('error when player acts out of turn', () => {
    const room = startedRoom(); // p1's turn
    expect(room.action('p2', { type: 'rest_day' }).error).toBeDefined();
  });
});

// ─── reconnect / disconnect ───────────────────────────────────────────────────

describe('GameRoom.reconnect / disconnect', () => {
  test('disconnect marks player as not connected', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    room.disconnect('p1');
    expect(room.players[0].connected).toBe(false);
  });

  test('reconnect updates socket id and sets connected', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    room.addPlayer('p1', 'Alice');
    room.disconnect('p1');
    const result = room.reconnect('p1-new', 'Alice');
    expect(result.ok).toBe(true);
    expect(room.players[0].id).toBe('p1-new');
    expect(room.players[0].connected).toBe(true);
  });

  test('reconnect error for unknown name', () => {
    const room = new GameRoom('room1', 'p1', 'open', MAP);
    expect(room.reconnect('p1', 'Unknown').error).toBeDefined();
  });
});
