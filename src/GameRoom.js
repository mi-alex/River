const { createPlayer, applyPurchases, initTurn, processAction, computeResults } = require('./GameRules');

class GameRoom {
  constructor(roomId, hostId, mode, map) {
    this.roomId = roomId;
    this.mode = mode;
    this.map = map;
    this.phase = 'lobby';
    this.players = [];
    this.hostId = hostId;
    this.currentPlayerIndex = 0;
    this.turn = null;
    this.round = 1;
    this.finishTriggered = false;
    this.finishTriggerPlayerIndex = null;
    this.results = null;
    this.revealedSquares = new Set([1]); // for closed mode
  }

  addPlayer(socketId, name) {
    if (this.phase !== 'lobby' && this.phase !== 'pre_game') return { error: 'Игра уже началась' };
    if (this.players.length >= 6) return { error: 'Комната заполнена' };
    if (this.players.find(p => p.name === name)) return { error: 'Имя занято' };

    const colorIndex = this.players.length;
    const player = createPlayer(socketId, name, colorIndex, this.mode);
    this.players.push(player);

    if (this.players.length === 1) {
      this.phase = 'pre_game';
    }

    return { ok: true, player };
  }

  reconnect(socketId, name) {
    const player = this.players.find(p => p.name === name);
    if (!player) return { error: 'Игрок не найден' };
    player.id = socketId;
    player.connected = true;
    return { ok: true, player };
  }

  disconnect(socketId) {
    const player = this.players.find(p => p.id === socketId);
    if (player) player.connected = false;
  }

  purchase(socketId, purchases) {
    if (this.phase !== 'pre_game') return { error: 'Покупки недоступны' };
    const player = this.players.find(p => p.id === socketId);
    if (!player) return { error: 'Игрок не найден' };
    if (player.ready) return { error: 'Вы уже готовы' };
    return applyPurchases(player, purchases);
  }

  markReady(socketId) {
    if (this.phase !== 'pre_game') return { error: 'Нельзя отметить готовность сейчас' };
    const player = this.players.find(p => p.id === socketId);
    if (!player) return { error: 'Игрок не найден' };
    player.ready = true;

    const allReady = this.players.length >= 2 && this.players.every(p => p.ready);
    if (allReady) {
      this.startGame();
    }
    return { ok: true, allReady };
  }

  startGame() {
    this.phase = 'playing';
    this.currentPlayerIndex = 0;
    this.round = 1;
    this.turn = initTurn(this.players[0]);
    this._updateRevealedSquares();
  }

  action(socketId, action) {
    if (this.phase !== 'playing') return { error: 'Игра не идёт' };
    const result = processAction(this, socketId, action);
    if (!result.ok) return result;

    if (this.turn.phase === 'done') {
      this._advanceTurn();
    }

    return result;
  }

  _advanceTurn() {
    const nextIndex = (this.currentPlayerIndex + 1) % this.players.length;

    if (this.finishTriggered && nextIndex === this.finishTriggerPlayerIndex) {
      this.phase = 'finished';
      this.results = computeResults(this.players);
      this.turn = null;
      return;
    }

    this.currentPlayerIndex = nextIndex;
    if (nextIndex === 0) this.round++;

    // Skip disconnected players
    let skips = 0;
    while (!this.players[this.currentPlayerIndex].connected && skips < this.players.length) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
      skips++;
    }

    this.turn = initTurn(this.players[this.currentPlayerIndex]);
    this._updateRevealedSquares();
  }

  _updateRevealedSquares() {
    if (this.mode !== 'closed') return;
    const leader = this.players.reduce((a, b) => a.position > b.position ? a : b);
    const leaderSquare = this.map[leader.position].square_id;
    this.revealedSquares.add(leaderSquare);
    // Reveal adjacent squares up to and including the leader's
    for (let s = 1; s <= leaderSquare; s++) this.revealedSquares.add(s);
  }

  toJSON() {
    return {
      roomId: this.roomId,
      mode: this.mode,
      phase: this.phase,
      players: this.players,
      currentPlayerIndex: this.currentPlayerIndex,
      turn: this.turn,
      round: this.round,
      finishTriggered: this.finishTriggered,
      results: this.results,
      revealedSquares: [...this.revealedSquares],
    };
  }
}

module.exports = GameRoom;
