export class GlobalChat {
  constructor(root, { onSend, onOpenChange } = {}) {
    this.root = root;
    this.onSend = onSend;
    this.onOpenChange = onOpenChange;
    this.toggleButton = root.querySelector('#chat-toggle');
    this.messages = root.querySelector('#chat-messages');
    this.form = root.querySelector('#chat-form');
    this.input = root.querySelector('#chat-input');
    this.active = false;
    this.enabled = false;
    this.recentTimer = null;

    this.onToggle = () => this.active ? this.close() : this.open();
    this.onSubmit = (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      const sent = this.onSend?.(text);
      if (sent) {
        this.add(sent.displayName, sent.text, true);
        this.input.value = '';
        this.close();
      } else {
        this.add('Sistema', 'Messaggio non inviato: controlla la connessione o riprova tra poco.');
      }
    };
    this.onKeyDown = (event) => {
      if (!this.enabled) return;
      if (event.code === 'Enter' && !event.repeat && !this.active
        && !event.target?.matches?.('input, textarea, select')) {
        event.preventDefault();
        this.open();
      } else if (event.code === 'Escape' && this.active) {
        event.preventDefault();
        this.close();
      }
    };
    this.onViewportChange = () => {
      const viewport = globalThis.visualViewport;
      const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
      const covered = coarse && viewport
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      this.root.style.setProperty('--chat-keyboard-offset', `${Math.round(covered)}px`);
    };

    this.toggleButton.addEventListener('click', this.onToggle);
    this.form.addEventListener('submit', this.onSubmit);
    window.addEventListener('keydown', this.onKeyDown);
    globalThis.visualViewport?.addEventListener('resize', this.onViewportChange);
    globalThis.visualViewport?.addEventListener('scroll', this.onViewportChange);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.root.hidden = !this.enabled;
    if (!this.enabled) this.close();
  }

  open() {
    if (!this.enabled || this.active) return;
    this.active = true;
    this.root.classList.add('active');
    this.form.hidden = false;
    this.toggleButton.setAttribute('aria-expanded', 'true');
    this.onOpenChange?.(true);
    this.onViewportChange();
    this.input.focus();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.root.classList.remove('active');
    this.form.hidden = true;
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.input.blur();
    this.onOpenChange?.(false);
    this.root.style.setProperty('--chat-keyboard-offset', '0px');
  }

  add(name, text, own = false) {
    if (!this.enabled) return;
    const line = document.createElement('div');
    line.className = own ? 'chat-line own' : 'chat-line';
    const author = document.createElement('strong');
    author.textContent = `${name}: `;
    const content = document.createElement('span');
    content.textContent = text;
    line.append(author, content);
    this.messages.append(line);
    while (this.messages.childElementCount > 6) this.messages.firstElementChild.remove();
    this.root.classList.add('recent');
    clearTimeout(this.recentTimer);
    this.recentTimer = setTimeout(() => this.root.classList.remove('recent'), 9000);
  }

  dispose() {
    this.close();
    this.enabled = false;
    this.root.hidden = true;
    clearTimeout(this.recentTimer);
    this.toggleButton.removeEventListener('click', this.onToggle);
    this.form.removeEventListener('submit', this.onSubmit);
    window.removeEventListener('keydown', this.onKeyDown);
    globalThis.visualViewport?.removeEventListener('resize', this.onViewportChange);
    globalThis.visualViewport?.removeEventListener('scroll', this.onViewportChange);
  }
}
