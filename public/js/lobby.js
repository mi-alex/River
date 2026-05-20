const socket = io();
const params = new URLSearchParams(location.search);
const roomIdFromURL = params.get('room');

const createSection = document.getElementById('create-section');
const joinSection = document.getElementById('join-section');
const errorEl = document.getElementById('lobby-error');

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function clearError() { errorEl.style.display = 'none'; }

if (roomIdFromURL) {
  // Arrived via invite link
  createSection.style.display = 'none';
  joinSection.style.display = 'flex';
  document.getElementById('room-id-display').textContent = roomIdFromURL;
}

document.getElementById('create-btn').addEventListener('click', () => {
  clearError();
  const name = document.getElementById('create-name').value.trim();
  if (!name) { showError('Введите имя'); return; }
  const mode = document.getElementById('create-mode').value;
  socket.emit('create_room', { mode });
  socket.once('room_created', ({ roomId }) => {
    sessionStorage.setItem('playerName', name);
    sessionStorage.setItem('roomId', roomId);
    location.href = `/game.html?room=${roomId}`;
  });
});

document.getElementById('join-btn')?.addEventListener('click', () => {
  clearError();
  const name = document.getElementById('join-name').value.trim();
  if (!name) { showError('Введите имя'); return; }
  sessionStorage.setItem('playerName', name);
  sessionStorage.setItem('roomId', roomIdFromURL);
  location.href = `/game.html?room=${roomIdFromURL}`;
});

document.getElementById('new-game-btn')?.addEventListener('click', () => {
  location.href = '/';
});

socket.on('error', ({ message }) => showError(message));
