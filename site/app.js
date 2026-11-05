(() => {
  const D = window.PUZZLE_DATA;
  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(norm(s))));
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  const KEY = 'bday-puzzle-v1';
  let state = { user: '', unlocked: 0, answers: [] }; // unlocked = index of furthest open stage
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));
  let cur = 0;

  if (!window.crypto || !crypto.subtle) {
    document.body.insertAdjacentHTML('afterbegin', '<p style="color:#ff8a9b;position:fixed;top:4px;left:8px;z-index:9">Please open this page through https:// (the website link), not as a file.</p>');
  }

  function show(id) {
    ['login', 'game', 'finale'].forEach((x) => $(x).classList.toggle('hidden', x !== id));
    window.scrollTo(0, 0);
  }

  // ---------- login ----------
  $('loginRiddle').textContent = D.login.riddle;
  async function doLogin() {
    const h = await sha($('pass').value);
    if (h === D.login.hash) {
      state.user = $('user').value.trim() || D.herName;
      save();
      state.unlocked > D.stages.length - 1 && state.answers.length >= D.stages.length ? finale() : (cur = Math.min(state.unlocked, D.stages.length - 1), render());
    } else {
      $('loginErr').textContent = 'Not quite... read the riddle again 🙂';
      $('loginBtn').classList.add('shake');
      setTimeout(() => $('loginBtn').classList.remove('shake'), 500);
    }
  }
  $('loginBtn').onclick = doLogin;
  $('pass').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };

  // ---------- stages ----------
  function render() {
    show('game');
    const s = D.stages[cur];
    $('stageNum').textContent = `Puzzle ${cur + 1} / ${D.stages.length}`;
    $('barFill').style.width = (state.unlocked / D.stages.length) * 100 + '%';
    $('title').textContent = s.title;
    $('story').textContent = s.story;
    $('body').innerHTML = s.body;
    $('err').textContent = '';
    $('hint').classList.add('hidden');
    $('hint').textContent = s.hint;
    const solved = cur < state.unlocked;
    $('inputs').innerHTML = s.inputs.map((inp, i) =>
      `<label><span>${inp.label}</span><input data-i="${i}" autocomplete="off" spellcheck="false" value="${solved ? (state.answers[cur] || [])[i] || '' : ''}"></label>`).join('');
    $('prevBtn').disabled = cur === 0;
    $('nextBtn').disabled = cur >= state.unlocked;
    if (s.sudoku) buildSudoku(s.sudoku);
    if (s.onShow === 'console') {
      console.log('%c' + s.consoleMsg, 'font-size:22px;color:#ffd98a;background:#2b1a55;padding:8px 12px;border-radius:6px');
    }
    const chest = $('chestBtn');
    if (chest) chest.onclick = () => { $('chestMsg').textContent = 'The chest is empty.'; };
    const first = $('inputs').querySelector('input');
    if (first && !('ontouchstart' in window)) first.focus();
    $('inputs').querySelectorAll('input').forEach((el) => el.onkeydown = (e) => { if (e.key === 'Enter') check(); });
  }

  function buildSudoku({ puzzle, shadedRow }) {
    const host = $('sudoku-host');
    host.className = 'sudoku';
    host.innerHTML = puzzle.map((v, p) => {
      const sh = Math.floor(p / 9) === shadedRow ? ' shade' : '';
      return v ? `<input class="given${sh}" value="${v}" readonly tabindex="-1">`
               : `<input class="${sh.trim()}" maxlength="1" inputmode="numeric">`;
    }).join('');
    host.querySelectorAll('input:not(.given)').forEach((el) => {
      el.oninput = () => { el.value = el.value.replace(/[^1-9]/g, ''); };
    });
  }

  async function check() {
    const s = D.stages[cur];
    const vals = [...$('inputs').querySelectorAll('input')].map((e) => e.value);
    let ok = true;
    for (let i = 0; i < s.inputs.length; i++) {
      if ((await sha(vals[i])) !== s.inputs[i].hash) ok = false;
    }
    if (!ok) {
      $('err').textContent = 'That is not it yet. Try again, or press the hint 💡';
      $('checkBtn').classList.add('shake');
      setTimeout(() => $('checkBtn').classList.remove('shake'), 500);
      return;
    }
    state.answers[cur] = vals.map(norm);
    if (cur >= state.unlocked) state.unlocked = cur + 1;
    save();
    if (cur === D.stages.length - 1) return finale();
    cur++;
    render();
  }
  $('checkBtn').onclick = check;
  $('hintBtn').onclick = () => $('hint').classList.toggle('hidden');
  $('prevBtn').onclick = () => { if (cur > 0) { cur--; render(); } };
  $('nextBtn').onclick = () => { if (cur < state.unlocked) { cur++; render(); } };

  // ---------- finale ----------
  async function finale() {
    show('finale');
    $('finalName').textContent = state.user || D.herName;
    const pass = D.stages.map((_, i) => (state.answers[i] || []).join(',')).join('|');
    try {
      const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: b64(D.final.salt), iterations: D.final.iterations, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(D.final.iv) }, key, b64(D.final.data));
      const out = JSON.parse(new TextDecoder().decode(plain));
      $('finalMsg').textContent = out.message;
      $('finalCode').textContent = out.code;
      $('copyBtn').onclick = () => { navigator.clipboard.writeText(out.code); $('copyBtn').textContent = 'Copied! ✔'; };
    } catch (e) {
      $('finalMsg').textContent = 'Something went wrong unlocking the message. Go back and re-check the answers.';
    }
    confetti();
  }

  function confetti() {
    const c = $('confetti'), x = c.getContext('2d');
    const fit = () => { c.width = innerWidth; c.height = innerHeight; };
    fit(); addEventListener('resize', fit);
    const cols = ['#ffd98a', '#ff6f91', '#8affb0', '#9ad1ff', '#d6a8ff'];
    const bits = Array.from({ length: 220 }, () => ({
      x: Math.random() * innerWidth, y: -Math.random() * innerHeight, r: 4 + Math.random() * 6,
      v: 1.5 + Math.random() * 3.5, w: Math.random() * 2 - 1, c: cols[Math.floor(Math.random() * cols.length)], a: Math.random() * 6,
    }));
    (function tick() {
      x.clearRect(0, 0, c.width, c.height);
      for (const b of bits) {
        b.y += b.v; b.x += Math.sin(b.a += 0.05) + b.w;
        if (b.y > c.height + 10) { b.y = -10; b.x = Math.random() * c.width; }
        x.fillStyle = b.c; x.fillRect(b.x, b.y, b.r, b.r * 0.6);
      }
      requestAnimationFrame(tick);
    })();
  }

  // resume
  $('user').value = state.user || '';
})();
