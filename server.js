const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { loadBoard } = require('./src/boardLayout');
const GameRoom = require('./src/GameRoom');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

// Load map data once at startup
const MAP = loadBoard(path.join(__dirname, 'data', 'board1.csv'));
console.log(`Map loaded: ${MAP.length} fields`);

// rooms: Map<roomId, GameRoom>
const rooms = new Map();

function broadcast(roomId, event, data) {
  io.to(roomId).emit(event, data);
}

function sendState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcast(roomId, 'state', room.toJSON());
}

io.on('connection', socket => {
  console.log(`connect: ${socket.id}`);

  socket.on('create_room', ({ mode = 'open' } = {}) => {
    const roomId = uuidv4().slice(0, 8);
    const room = new GameRoom(roomId, socket.id, mode, MAP);
    rooms.set(roomId, room);
    socket.emit('room_created', { roomId });
  });

  socket.on('join_room', ({ roomId, playerName }) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { message: 'Комната не найдена' }); return; }

    // Check if this is a reconnect
    const existing = room.players.find(p => p.name === playerName);
    let result;
    if (existing && !existing.connected) {
      result = room.reconnect(socket.id, playerName);
    } else {
      result = room.addPlayer(socket.id, playerName);
    }

    if (result.error) { socket.emit('error', { message: result.error }); return; }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerName = playerName;

    socket.emit('joined', { playerId: socket.id, map: MAP });
    sendState(roomId);
  });

  socket.on('purchase', ({ food = 0, skills = 0, equipment = [] } = {}) => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room) return;
    const result = room.purchase(socket.id, { food, skills, equipment });
    if (result.error) { socket.emit('error', { message: result.error }); return; }
    sendState(roomId);
  });

  socket.on('mark_ready', () => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room) return;
    const result = room.markReady(socket.id);
    if (result.error) { socket.emit('error', { message: result.error }); return; }
    sendState(roomId);
  });

  socket.on('action', actionData => {
    const { roomId } = socket.data;
    const room = rooms.get(roomId);
    if (!room) return;
    const result = room.action(socket.id, actionData);
    if (result.error) { socket.emit('error', { message: result.error }); return; }
    // Send events to all players, then full state
    broadcast(roomId, 'events', { events: result.events, playerId: socket.id });
    sendState(roomId);
  });

  socket.on('disconnect', () => {
    const { roomId } = socket.data || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.disconnect(socket.id);
    console.log(`disconnect: ${socket.id} from room ${roomId}`);
    sendState(roomId);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
