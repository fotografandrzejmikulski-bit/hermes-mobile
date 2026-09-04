const PL = Object.freeze({
  locale: 'pl-PL',
  connecting: 'Nawiązywanie połączenia…',
  connected: 'Połączono z agentem',
  disconnected: 'Utracono połączenie z bramą',
  sendPlaceholder: 'Wpisz polecenie lub podyktuj zadanie…',
  voiceUnavailable: 'Rozpoznawanie mowy nie jest dostępne w tej przeglądarce.',
  networkError: 'Wystąpił błąd komunikacji z lokalną bramą Hermes.',
  tool: 'Agent uruchamia narzędzie:',
  resetConfirm: 'Czy chcesz rozpocząć nową sesję i wyczyścić ekran?'
});

const timeFormatter = new Intl.DateTimeFormat(PL.locale, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
});
const integerFormatter = new Intl.NumberFormat(PL.locale, { maximumFractionDigits: 0 });

const POLISH_SYSTEM_MESSAGE = Object.freeze({
  role: 'system',
  content:
    'Jesteś autonomicznym, wysoce precyzyjnym asystentem Hermes AI działającym w środowisku mobilnym. ' +
    'Domyślnym i nadrzędnym językiem komunikacji z użytkownikiem jest język polski. ' +
    'Zawsze komunikuj się po polsku, zachowując naturalną, precyzyjną i techniczną polszczyznę, poprawną fleksję, składnię, ortografię oraz interpunkcję. ' +
    'Rozumiej polecenia potoczne, skrótowe, techniczne i zawierające drobne błędy. ' +
    'Nie przełączaj się na język angielski bez wyraźnej prośby użytkownika. ' +
    'Nazwy własne, identyfikatory, nazwy modeli, narzędzi, funkcji, endpointów, komendy, ścieżki i kod zachowuj w oryginalnej postaci. ' +
    'Nie ujawniaj kluczy API, tokenów, sekretów ani poufnych danych konfiguracyjnych.'
});

class PolishVoiceInput {
  constructor(input, onEnd) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.input = input;
    this.onEnd = onEnd;
    this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
    this.listening = false;
    if (!this.recognition) return;
    this.recognition.lang = PL.locale;
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.onstart = () => { this.listening = true; input.closest('form')?.classList.add('voice-active'); };
    this.recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((r) => r[0]?.transcript || '').join('');
      input.value = transcript;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    this.recognition.onend = () => {
      this.listening = false;
      input.closest('form')?.classList.remove('voice-active');
      this.onEnd?.(input.value.trim());
    };
    this.recognition.onerror = () => { this.listening = false; input.closest('form')?.classList.remove('voice-active'); };
  }
  toggle() {
    if (!this.recognition) return false;
    try {
      if (this.listening) this.recognition.stop();
      else this.recognition.start();
      return true;
    } catch { return false; }
  }
}

class HermesApexCockpit {
  constructor() {
    this.wrapper = document.getElementById('viewport-wrapper');
    this.chat = document.getElementById('chat-viewport');
    this.list = document.getElementById('messages-list');
    this.form = document.getElementById('prompt-form');
    this.input = document.getElementById('user-input');
    this.send = document.getElementById('send-btn');
    this.mic = document.getElementById('mic-btn');
    this.tts = document.getElementById('tts-toggle');
    this.clear = document.getElementById('clear-btn');
    this.dot = document.getElementById('status-dot');
    this.status = document.getElementById('status-label');
    this.sessionId = this.getSession();
    this.ttsEnabled = localStorage.getItem('hermes_apex_tts') === 'true';
    this.recognition = new PolishVoiceInput(this.input, () => this.refreshMic());
    this.polishVoice = null;
    this.bind();
    this.initViewport();
    this.initTts();
    this.initSw();
    this.heartbeat();
    this.refreshMic();
    this.updateTts();
  }

  getSession() {
    let id = localStorage.getItem('hermes_apex_session');
    if (!id) { id = `pl_${crypto.randomUUID()}`; localStorage.setItem('hermes_apex_session', id); }
    return id;
  }

  haptic(pattern = 12) { try { navigator.vibrate?.(pattern); } catch {} }

  initViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const resize = () => {
      this.wrapper.style.height = `${vv.height}px`;
      requestAnimationFrame(() => this.chat.scrollTo({ top: this.chat.scrollHeight, behavior: 'auto' }));
    };
    vv.addEventListener('resize', resize, { passive: true });
    vv.addEventListener('scroll', resize, { passive: true });
    resize();
  }

  initTts() {
    if (!('speechSynthesis' in window)) { this.tts.hidden = true; return; }
    const load = () => {
      const voices = speechSynthesis.getVoices();
      this.polishVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith('pl')) || null;
    };
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
  }

  updateTts() {
    this.tts.classList.toggle('active', this.ttsEnabled);
    this.tts.setAttribute('aria-label', this.ttsEnabled ? 'Wyłącz lektora PL' : 'Włącz lektora PL');
  }

  speak(text) {
    if (!this.ttsEnabled || !text || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const clean = text.replace(/```[\s\S]*?```/g, 'Fragment kodu.').replace(/`([^`]+)`/g, '$1').replace(/[*#_~]/g, '');
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = PL.locale;
    if (this.polishVoice) utterance.voice = this.polishVoice;
    utterance.rate = 1.02;
    speechSynthesis.speak(utterance);
  }

  bind() {
    this.form.addEventListener('submit', (event) => { event.preventDefault(); this.submit(); });
    this.input.addEventListener('input', () => {
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(this.input.scrollHeight, 140)}px`;
    });
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.submit(); }
    });
    this.mic.addEventListener('click', () => { this.haptic(15); this.recognition.toggle(); this.refreshMic(); });
    this.tts.addEventListener('click', () => {
      this.ttsEnabled = !this.ttsEnabled;
      localStorage.setItem('hermes_apex_tts', String(this.ttsEnabled));
      if (!this.ttsEnabled) speechSynthesis?.cancel();
      this.updateTts(); this.haptic(15);
    });
    this.clear.addEventListener('click', () => {
      if (!confirm(PL.resetConfirm)) return;
      localStorage.removeItem('hermes_apex_session');
      this.sessionId = this.getSession();
      this.list.replaceChildren();
      this.addSystem('Nowa sesja została zainicjalizowana.');
      this.haptic(30);
    });
  }

  refreshMic() {
    this.mic.classList.toggle('recording', Boolean(this.recognition.listening));
    this.mic.textContent = this.recognition.listening ? 'Stop' : 'Mikrofon';
    this.mic.disabled = !this.recognition.recognition;
    if (!this.recognition.recognition) this.mic.title = PL.voiceUnavailable;
  }

  async heartbeat() {
    try {
      const response = await fetch('/healthz', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      this.dot.className = 'dot-indicator online';
      this.status.textContent = `${PL.connected} · ${data.jezyk || PL.locale}`;
    } catch {
      this.dot.className = 'dot-indicator offline';
      this.status.textContent = PL.disconnected;
    } finally {
      setTimeout(() => this.heartbeat(), 7000);
    }
  }

  addSystem(text) {
    const node = document.createElement('div');
    node.className = 'system-card';
    node.textContent = `[${timeFormatter.format(new Date())}] ${text}`;
    this.list.appendChild(node);
    this.scrollBottom();
  }

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.textContent;
  }

  render(container, text) {
    container.replaceChildren();
    const regex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    let cursor = 0;
    let match;
    const appendText = (value) => {
      if (!value) return;
      const node = document.createElement('div');
      node.textContent = value;
      container.appendChild(node);
    };
    while ((match = regex.exec(text))) {
      appendText(text.slice(cursor, match.index));
      const wrap = document.createElement('div');
      wrap.className = 'code-container';
      const header = document.createElement('div');
      header.className = 'code-header';
      const label = document.createElement('span'); label.textContent = (match[1] || 'tekst').toUpperCase();
      const copy = document.createElement('button'); copy.className = 'copy-btn'; copy.type = 'button'; copy.textContent = 'Kopiuj';
      copy.addEventListener('click', async () => { await navigator.clipboard?.writeText(match[2]); copy.textContent = 'Skopiowano'; this.haptic(18); setTimeout(() => { copy.textContent = 'Kopiuj'; }, 1500); });
      header.append(label, copy);
      const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = match[2]; pre.appendChild(code);
      wrap.append(header, pre); container.appendChild(wrap);
      cursor = match.index + match[0].length;
    }
    appendText(text.slice(cursor));
  }

  scrollBottom() { requestAnimationFrame(() => this.chat.scrollTo({ top: this.chat.scrollHeight, behavior: 'smooth' })); }

  async submit() {
    const prompt = this.input.value.trim();
    if (!prompt || this.send.disabled) return;
    this.send.disabled = true;
    this.input.value = ''; this.input.style.height = 'auto';
    const user = document.createElement('div'); user.className = 'bubble user'; user.textContent = prompt; this.list.appendChild(user);
    const assistant = document.createElement('div'); assistant.className = 'bubble assistant'; assistant.textContent = '…'; this.list.appendChild(assistant);
    this.scrollBottom(); this.haptic(10);
    let responseText = '';
    try {
      const response = await fetch('/hermes-backend/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          messages: [POLISH_SYSTEM_MESSAGE, { role: 'user', content: prompt }],
          session_id: this.sessionId,
          stream: true
        })
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
          const data = line.trim();
          if (!data.startsWith('data:')) continue;
          const payload = data.slice(5).trim(); if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content ?? json.text ?? json.delta ?? '';
            if (delta) { responseText += delta; this.render(assistant, responseText); this.scrollBottom(); }
          } catch {}
        }
      }
      this.speak(responseText);
    } catch (error) {
      assistant.textContent = `${PL.networkError} (${error.message || 'błąd'})`;
      this.haptic([50, 100, 50]);
    } finally {
      this.send.disabled = false;
    }
  }

  async initSw() {
    if (!('serviceWorker' in navigator)) return;
    try { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch {}
  }
}

document.addEventListener('DOMContentLoaded', () => { window.hermesApex = new HermesApexCockpit(); });
