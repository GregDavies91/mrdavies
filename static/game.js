// Shared game logic for student client
let ws = null;
let room = null;
let myName = null;
let answered = false;

const joinCard = document.getElementById('joinCard');
const waitCard = document.getElementById('waitCard');
const gameCard = document.getElementById('gameCard');
const resultCard = document.getElementById('resultCard');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const errEl = document.getElementById('err');
const showCode = document.getElementById('showCode');
const gCode = document.getElementById('gCode');
const qNum = document.getElementById('qNum');
const qTot = document.getElementById('qTot');
const qCat = document.getElementById('qCat');
const qText = document.getElementById('qText');
const optsEl = document.getElementById('opts');
const feedback = document.getElementById('feedback');
const finalRank = document.getElementById('finalRank');
const finalScore = document.getElementById('finalScore');
const leaderboard = document.getElementById('leaderboard');

// Get room from URL if present
const urlParams = new URLSearchParams(location.search);
if(urlParams.get('room')){
  roomInput.value = urlParams.get('room').toUpperCase();
  roomInput.readOnly = true;
  roomInput.style.background = '#0a1128';
}

roomInput.addEventListener('input', e=>{
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
});
joinBtn.addEventListener('click', joinGame);
roomInput.addEventListener('keydown', e=>{ if(e.key==='Enter') joinGame(); });
nameInput.addEventListener('keydown', e=>{ if(e.key==='Enter') joinGame(); });

function joinGame(){
  const code = roomInput.value.trim().toUpperCase();
  const name = nameInput.value.trim() || 'Player';
  if(code.length!==4){ errEl.textContent='Enter the 4-letter room code'; return; }
  errEl.textContent='';
  joinBtn.disabled = true;
  joinBtn.textContent = 'Joining…';
  room = code;
  myName = name.slice(0,20);
  connect();
}

function connect(){
  const WS_HOST = window.WS_HOST || (location.protocol==='https:' ? 'wss://mrdavies.onrender.com' : location.host);
  ws = new WebSocket(`${WS_HOST.startsWith('ws')?'':'ws://'}${WS_HOST}/ws/${room}/player`);
  ws.onopen = ()=>{
    ws.send(JSON.stringify({type:'join', name:myName}));
  };
  ws.onmessage = e=> handleMsg(JSON.parse(e.data));
  ws.onclose = ()=>{
    if(!document.getElementById('resultCard').classList.contains('on')){
      setTimeout(connect, 2000);
    }
  };
  ws.onerror = ()=>{ errEl.textContent='Connection failed. Is the game running?'; };
}

function handleMsg(msg){
  if(msg.type==='joined'){
    showCode.textContent = msg.room;
    gCode.textContent = msg.room;
    joinCard.classList.remove('on');
    waitCard.classList.add('on');
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Game';
  }else if(msg.type==='state'){
    renderState(msg);
  }else if(msg.type==='kicked'){
    alert('You were removed from the game.');
    location.reload();
  }else if(msg.type==='error'){
    errEl.textContent = msg.msg;
    joinBtn.disabled = false;
    joinBtn.textContent = 'Join Game';
  }else if(msg.type==='answer_received'){
    answered = true;
    feedback.textContent = 'Answer submitted! Waiting for teacher…';
    feedback.hidden = false;
    feedback.style.borderColor = '#233050';
    feedback.style.background = '#0a1128';
    feedback.style.color = 'var(--muted)';
    // disable buttons
    document.querySelectorAll('.opt-btn').forEach(b=>b.classList.add('locked'));
  }
}

function renderState(s){
  const phase = s.phase;

  // Hide all cards
  waitCard.classList.remove('on');
  gameCard.classList.remove('on');
  resultCard.classList.remove('on');

  if(phase==='lobby'){
    waitCard.classList.add('on');
  }else if(phase==='question' && s.question){
    gameCard.classList.add('on');
    answered = false;
    feedback.hidden = true;
    qNum.textContent = s.q_index + 1;
    qTot.textContent = s.total_q;
    qCat.textContent = s.question.cat;
    qText.textContent = s.question.text;
    optsEl.innerHTML = s.question.options.map((opt,i)=>
      `<button class="opt-btn" data-idx="${i}" onclick="sendAnswer(${i})">${escapeHtml(opt)}</button>`
    ).join('');
  }else if(phase==='answer' && s.question){
    gameCard.classList.add('on');
    qNum.textContent = s.q_index + 1;
    qTot.textContent = s.total_q;
    qCat.textContent = s.question.cat;
    qText.textContent = s.question.text;
    const myAns = s.player_answers?.[myName];
    optsEl.innerHTML = s.question.options.map((opt,i)=>`<button class="opt-btn ${i===s.answer.correct_idx?'correct':''} ${myAns===i && i!==s.answer.correct_idx?'wrong':''} locked" data-idx="${i}">${escapeHtml(opt)}</button>`).join('');
    if(myAns!==undefined){
      if(myAns===s.answer.correct_idx){
        feedback.textContent = '✅ Correct! +10 pts';
        feedback.style.borderColor = 'var(--accent)';
        feedback.style.background = 'rgba(0,212,170,.15)';
        feedback.style.color = 'var(--accent)';
      }else{
        feedback.textContent = `❌ Incorrect. Correct: ${escapeHtml(s.answer.correct)}`;
        feedback.style.borderColor = 'var(--red)';
        feedback.style.background = 'rgba(255,71,87,.1)';
        feedback.style.color = 'var(--red)';
      }
      feedback.hidden = false;
    }
  }else if(phase==='leaderboard' || phase==='ended'){
    resultCard.classList.add('on');
    const me = s.players.find(p=>p.name===myName);
    if(me){
      const rank = s.players.filter(p=>p.score>me.score).length + 1;
      const suffix = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'';
      finalRank.textContent = `${suffix} You finished ${rank}${ordinal(rank)}!`;
      finalScore.textContent = `${me.score} points`;
    }
    const sorted = [...s.players].sort((a,b)=>b.score-a.score);
    leaderboard.innerHTML = sorted.map((p,i)=>`<div class="lb-row"><div class="lb-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i+1}</div><div class="lb-name">${escapeHtml(p.name)}${p.name===myName?' (you)':''}</div><div class="lb-score">${p.score}</div></div>`).join('');
  }
}

function sendAnswer(idx){
  if(answered) return;
  answered = true;
  ws.send(JSON.stringify({type:'answer', ans:idx}));
  document.querySelectorAll('.opt-btn').forEach(b=>b.classList.add('locked'));
  feedback.textContent = 'Answer submitted! Waiting for teacher…';
  feedback.hidden = false;
  feedback.style.borderColor = '#233050';
  feedback.style.background = '#0a1128';
  feedback.style.color = 'var(--muted)';
}

function escapeHtml(s){
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'");
}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return s[(v-20)%10]||s[v]||s[0];}