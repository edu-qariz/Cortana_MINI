'use strict';

const { esc, htmlPage } = require('./html-ui');

/* ══════════════════════════════════════════════════════════════
 * 🎰 SLOT MACHINE — self-contained, client-side, mobile first
 * ══════════════════════════════════════════════════════════════ */

function buildSlotHtml({ botName = 'CORTANA' } = {}) {
    const css = `
.machine{border-radius:20px;padding:14px 12px;position:relative;overflow:hidden;
  background:linear-gradient(165deg,rgba(36,8,20,.92),rgba(10,2,8,.94));
  border:1px solid rgba(255,255,255,.13);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 16px 36px rgba(0,0,0,.55)}
.machine::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.10) 48%,transparent 62%);
  transform:translateX(-120%);animation:sheen 5s ease-in-out infinite}
@keyframes sheen{0%,70%{transform:translateX(-120%)}90%,100%{transform:translateX(120%)}}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
.brand{font-size:12px;font-weight:900;letter-spacing:1.2px;text-transform:uppercase;
  background:linear-gradient(92deg,#ef4444,#25d366);-webkit-background-clip:text;background-clip:text;color:transparent}
.credits{font-size:11px;font-weight:900;color:var(--warn);border:1px solid rgba(251,191,36,.3);
  background:rgba(251,191,36,.08);border-radius:9px;padding:4px 9px}
.reels{display:flex;gap:7px;justify-content:center;padding:10px 8px;position:relative;
  border-radius:16px;background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,.28));
  border:1px solid rgba(255,255,255,.09)}
.payline{position:absolute;left:8px;right:8px;top:50%;height:2px;transform:translateY(-1px);
  background:linear-gradient(90deg,transparent,rgba(219,39,119,.85),transparent);
  box-shadow:0 0 8px rgba(219,39,119,.45);pointer-events:none;z-index:2}
.reel{flex:1;max-width:86px;height:216px;overflow:hidden;border-radius:12px;
  background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.02));
  border:1px solid rgba(255,255,255,.13);box-shadow:inset 0 8px 16px rgba(0,0,0,.55),inset 0 -8px 16px rgba(0,0,0,.55)}
.strip{display:flex;flex-direction:column;will-change:transform}
.sym{height:72px;display:grid;place-items:center;font-size:34px;line-height:1;
  filter:drop-shadow(0 2px 5px rgba(0,0,0,.5))}
.reel.win{border-color:rgba(34,197,94,.8);box-shadow:0 0 0 1px rgba(34,197,94,.45),0 0 16px rgba(34,197,94,.25)}
.msg{margin-top:12px;text-align:center;font-size:13px;font-weight:800;min-height:20px;color:var(--dim)}
.msg.win{color:#22c55e}
.msg.lose{color:#ef4444}
.msg.jack{color:#fbbf24;text-shadow:0 0 12px rgba(251,191,36,.4)}
.controls{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap}
.bet{display:flex;gap:5px;flex:1;flex-wrap:wrap}
.chip{font-size:11px;font-weight:800;padding:7px 10px;border-radius:9px;cursor:pointer;
  border:1px solid var(--line);background:var(--glass);color:var(--dim)}
.chip.active{background:var(--grad);color:#fff;border-color:transparent}
.spin{flex:1 0 110px;min-height:44px;font-size:14px;font-weight:900;letter-spacing:1px;
  border-radius:12px;border:none;background:var(--grad);color:#fff;cursor:pointer}
.spin:disabled{filter:grayscale(.6) brightness(.75);cursor:not-allowed}
.paytable{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px}
.pt{display:flex;justify-content:space-between;gap:6px;font-size:10.5px;font-weight:700;
  color:var(--dim);border:1px solid var(--line);background:var(--glass);border-radius:8px;padding:5px 7px}
.pt b{color:var(--warn)}
.flash{position:fixed;inset:0;z-index:40;pointer-events:none;opacity:0;
  background:radial-gradient(circle at 50% 45%,rgba(236,72,153,.22),transparent 62%);
  transition:opacity .25s}
.flash.on{opacity:1;animation:pulse .5s ease-in-out 3}
@keyframes pulse{50%{opacity:.25}}
`;

    const body = `
<div class="machine">
  <div class="topbar">
    <div class="brand">🎰 ${esc(botName)} slots</div>
    <div class="credits">🪙 <span id="credits">1000</span></div>
  </div>
  <div class="reels">
    <div class="reel"><div class="strip" id="s0"></div></div>
    <div class="reel"><div class="strip" id="s1"></div></div>
    <div class="reel"><div class="strip" id="s2"></div></div>
    <div class="payline"></div>
  </div>
  <div class="msg" id="msg">Pull the lever or hit SPIN 👉</div>
  <div class="controls">
    <div class="bet" id="bet">
      <button class="chip active" data-b="25">🪙 25</button>
      <button class="chip" data-b="50">🪙 50</button>
      <button class="chip" data-b="100">🪙 100</button>
      <button class="chip" data-b="250">🪙 250</button>
    </div>
    <button class="spin" id="spin">SPIN</button>
  </div>
  <div class="paytable">
    <div class="pt"><span>💎💎💎</span><b>x50</b></div>
    <div class="pt"><span>7️⃣7️⃣7️⃣</span><b>x30</b></div>
    <div class="pt"><span>👑👑👑</span><b>x20</b></div>
    <div class="pt"><span>⭐⭐⭐</span><b>x12</b></div>
    <div class="pt"><span>🍒🍒🍒</span><b>x8</b></div>
    <div class="pt"><span>Any 2 match</span><b>x2</b></div>
  </div>
</div>
<div class="foot">🎮 ${esc(botName)} Slots · demo coins reset when you reopen</div>
<div class="flash" id="flash"></div>`;

    const script = `
var H = 72;
var SYMS = [
  {e:'💎', w:2,  p3:50, p2:6},
  {e:'7️⃣', w:4,  p3:30, p2:5},
  {e:'👑', w:6,  p3:20, p2:4},
  {e:'⭐', w:9,  p3:12, p2:3},
  {e:'🍒', w:14, p3:8,  p2:2},
  {e:'🔔', w:16, p3:6,  p2:2},
  {e:'🍋', w:16, p3:4,  p2:1},
  {e:'🍇', w:16, p3:4,  p2:1}
];
var TOTAL = SYMS.reduce(function(a,s){ return a + s.w; }, 0);
var credits = 1000;
var bet = 25;
var spinning = false;

function pick() {
  var r = Math.random() * TOTAL, acc = 0;
  for (var i = 0; i < SYMS.length; i++) { acc += SYMS[i].w; if (r < acc) return SYMS[i]; }
  return SYMS[0];
}

function paint() { document.getElementById('credits').textContent = credits; }

function buildStrip(i) {
  var strip = document.getElementById('s' + i);
  var res = pick();
  var syms = [];
  for (var j = 0; j < 24; j++) syms.push(pick());
  syms.push(pick());
  syms.push(res);
  syms.push(pick());
  var html = '';
  for (var k = 0; k < syms.length; k++) html += '<div class="sym">' + syms[k].e + '</div>';
  strip.innerHTML = html;
  return { res: res, len: syms.length };
}

function resetReel(i) {
  var strip = document.getElementById('s' + i);
  strip.style.transition = 'none';
  strip.style.transform = 'translateY(0px)';
  strip.parentNode.classList.remove('win');
}

function spinReel(i, data, done) {
  var strip = document.getElementById('s' + i);
  void strip.offsetHeight;
  var target = data.len - 2;
  var dist = (target - 1) * H;
  var dur = 1500 + i * 350;
  strip.style.transition = 'transform ' + dur + 'ms cubic-bezier(.14,.85,.22,1)';
  strip.style.transform = 'translateY(-' + dist + 'px)';
  setTimeout(done, dur + 60);
}

function evaluate(a, b, c) {
  var msg = document.getElementById('msg');
  msg.className = 'msg';
  for (var i = 0; i < 3; i++) document.getElementById('s' + i).parentNode.classList.remove('win');

  var win = 0, label = '';
  if (a.e === b.e && b.e === c.e) {
    win = bet * a.p3;
    label = a.e + ' x' + a.p3;
    for (var j = 0; j < 3; j++) document.getElementById('s' + j).parentNode.classList.add('win');
  } else {
    var pair = null;
    if (a.e === b.e) pair = a;
    else if (b.e === c.e) pair = b;
    else if (a.e === c.e) pair = a;
    if (pair) { win = bet * pair.p2; label = '2x ' + pair.e + ' → x' + pair.p2; }
  }

  if (win > 0) {
    credits += win;
    var jackpot = win >= bet * 20;
    msg.className = 'msg ' + (jackpot ? 'jack' : 'win');
    msg.textContent = (jackpot ? '🎉 JACKPOT! ' : '✅ WIN! ') + label + ' (+' + win + ' 🪙)';
    var flash = document.getElementById('flash');
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    setTimeout(function () { flash.classList.remove('on'); }, 1700);
  } else {
    msg.className = 'msg lose';
    msg.textContent = '❌ No match — spin again';
  }
  paint();
}

function spin() {
  if (spinning) return;
  if (credits < bet) {
    var m = document.getElementById('msg');
    m.className = 'msg lose';
    m.textContent = '🚫 Not enough coins — lower your bet';
    return;
  }
  spinning = true;
  credits -= bet;
  paint();
  document.getElementById('spin').disabled = true;
  var msg = document.getElementById('msg');
  msg.className = 'msg';
  msg.textContent = '🎲 Spinning…';

  var results = [], datas = [];
  for (var i = 0; i < 3; i++) { resetReel(i); datas.push(buildStrip(i)); results.push(datas[i].res); }

  var finished = 0;
  for (var j = 0; j < 3; j++) {
    (function (idx) {
      spinReel(idx, datas[idx], function () {
        finished++;
        if (finished === 3) {
          evaluate(results[0], results[1], results[2]);
          spinning = false;
          document.getElementById('spin').disabled = false;
        }
      });
    })(j);
  }
}

document.getElementById('spin').onclick = spin;
document.getElementById('bet').onclick = function (event) {
  var chip = event.target.closest('.chip');
  if (!chip || spinning) return;
  var chips = document.querySelectorAll('.chip');
  for (var i = 0; i < chips.length; i++) chips[i].classList.remove('active');
  chip.classList.add('active');
  bet = parseInt(chip.getAttribute('data-b'), 10) || 25;
};

for (var start = 0; start < 3; start++) { resetReel(start); buildStrip(start); }
paint();
`;

    return htmlPage({ title: `${botName} Slots`, css, body, script });
}

/* ══════════════════════════════════════════════════════════════
 * 🎡 LUCKY WHEEL — canvas, client-side spin
 * ══════════════════════════════════════════════════════════════ */

const DEFAULT_WHEEL = [
    '💎 50', '⭐ 20', '🍒 5', '🔔 10',
    '🍀 15', '👑 30', '🍋 2', '🎁 25',
];

function buildWheelHtml({ botName = 'CORTANA', options = [] } = {}) {
    const labels = (options && options.length >= 2 ? options : DEFAULT_WHEEL).slice(0, 8);
    const prizes = labels.map((label, index) => ({
        label: String(label).slice(0, 16),
        color: ['#db2777', '#7c3aed', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#a855f7'][index % 8],
    }));

    const css = `
.wheelbox{display:grid;place-items:center;position:relative;padding:6px 0 2px}
.pointer{width:0;height:0;border-left:13px solid transparent;border-right:13px solid transparent;
  border-top:24px solid #e11d48;position:relative;z-index:3;margin-bottom:-7px;
  filter:drop-shadow(0 4px 8px rgba(225,29,72,.45))}
canvas{display:block;border-radius:50%;max-width:100%;height:auto;
  box-shadow:0 0 0 6px rgba(255,255,255,.07),0 0 0 11px rgba(124,58,237,.18),0 18px 38px rgba(0,0,0,.55)}
.result{margin-top:12px;text-align:center;font-size:15px;font-weight:900;min-height:24px;color:var(--dim);transition:all .25s}
.result.on{color:#fbbf24;text-shadow:0 0 12px rgba(251,191,36,.4);transform:scale(1.05)}
.spinbtn{width:100%;margin-top:12px;min-height:46px;font-size:15px;font-weight:900;letter-spacing:1.2px;
  border:none;border-radius:12px;background:var(--grad);color:#fff;cursor:pointer}
.spinbtn:disabled{filter:grayscale(.6) brightness(.75);cursor:not-allowed}
.history{display:flex;gap:5px;flex-wrap:wrap;justify-content:center;margin-top:12px}
.hchip{font-size:10.5px;font-weight:700;color:var(--dim);border:1px solid var(--line);
  background:var(--glass);border-radius:8px;padding:4px 8px}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:12px}
.stat{border:1px solid var(--line);background:var(--glass);border-radius:10px;padding:7px;text-align:center}
.stat b{display:block;font-size:15px;font-weight:900;color:var(--txt)}
.stat span{font-size:9.5px;color:var(--dim);letter-spacing:.7px;text-transform:uppercase}
`;

    const body = `
<div class="card">
  <div class="title">🎡 ${esc(botName)} LUCKY WHEEL</div>
  <div class="sub">Give it a spin — pure luck, zero mercy. 🍀</div>
</div>
<div class="card" style="margin-top:10px">
  <div class="wheelbox">
    <div class="pointer"></div>
    <canvas id="wheel" width="320" height="320"></canvas>
  </div>
  <div class="result" id="result">Press SPIN to try your luck 🎯</div>
  <button class="spinbtn" id="spin">🎡 SPIN THE WHEEL</button>
  <div class="history" id="history"></div>
  <div class="stats">
    <div class="stat"><b id="spins">0</b><span>spins</span></div>
    <div class="stat"><b id="last">—</b><span>last prize</span></div>
  </div>
</div>
<div class="foot">🎮 ${esc(botName)} Lucky Wheel · client-side game</div>`;

    const script = `
var PRIZES = ${JSON.stringify(prizes)};
var canvas = document.getElementById('wheel');
var ctx = canvas.getContext('2d');
var CX = canvas.width / 2, CY = canvas.height / 2, R = canvas.width / 2 - 6;
var rot = 0, spinning = false, spins = 0, history = [];

function draw() {
  var n = PRIZES.length, seg = (Math.PI * 2) / n;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (var i = 0; i < n; i++) {
    var start = rot + i * seg, end = start + seg;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, R, start, end);
    ctx.closePath();
    ctx.fillStyle = PRIZES[i].color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(start + seg / 2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px -apple-system,Segoe UI,Roboto,sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(PRIZES[i].label, R - 16, 2);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(CX, CY, 22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(9,3,5,.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#f6eef3';
  ctx.font = 'bold 16px -apple-system,Segoe UI,Roboto,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎯', CX, CY + 1);
}

function pushHistory(label) {
  history.unshift(label);
  history = history.slice(0, 6);
  var box = document.getElementById('history');
  box.innerHTML = '';
  for (var i = 0; i < history.length; i++) {
    var chip = document.createElement('span');
    chip.className = 'hchip';
    chip.textContent = history[i];
    box.appendChild(chip);
  }
}

function spin() {
  if (spinning) return;
  spinning = true;
  document.getElementById('spin').disabled = true;
  var result = document.getElementById('result');
  result.className = 'result';
  result.textContent = '🌀 spinning…';

  var n = PRIZES.length, seg = (Math.PI * 2) / n;
  var index = Math.floor(Math.random() * n);
  var current = rot % (Math.PI * 2);
  var desired = (-Math.PI / 2 - (index * seg + seg / 2)) % (Math.PI * 2);
  if (desired < 0) desired += Math.PI * 2;
  var delta = desired - current;
  if (delta < 0) delta += Math.PI * 2;
  var start = rot;
  var target = start + 6 * Math.PI * 2 + delta;
  var t0 = performance.now();
  var duration = 4200;

  function frame(t) {
    var p = Math.min(1, (t - t0) / duration);
    var eased = 1 - Math.pow(1 - p, 3);
    rot = start + (target - start) * eased;
    draw();
    if (p < 1) {
      requestAnimationFrame(frame);
      return;
    }
    spinning = false;
    document.getElementById('spin').disabled = false;
    var label = PRIZES[index].label;
    result.className = 'result on';
    result.textContent = '🎉 ' + label;
    document.getElementById('last').textContent = label;
    spins++;
    document.getElementById('spins').textContent = spins;
    pushHistory(label);
  }
  requestAnimationFrame(frame);
}

document.getElementById('spin').onclick = spin;
draw();
`;

    return htmlPage({ title: `${botName} Lucky Wheel`, css, body, script });
}

module.exports = { buildSlotHtml, buildWheelHtml };
