export class LoadingScreen {
  constructor(root) {
    this.root = root;
    this.status = root?.querySelector('#world-loading-status');
    this.percent = root?.querySelector('#world-loading-percent');
    this.bar = root?.querySelector('#world-loading-bar');
    this.detail = root?.querySelector('#world-loading-detail');
    this.lastProgress = 0;
  }

  show() {
    if (!this.root) return;
    this.lastProgress = 0;
    this.root.classList.remove('leaving');
    this.root.hidden = false;
    this.update('Preparazione del mondo…', 1, 'Caricamento risorse');
  }

  update(text, progress = null, detail = null) {
    if (!this.root) return;
    if (text && this.status) this.status.textContent = text;
    if (detail && this.detail) this.detail.textContent = detail;

    if (Number.isFinite(progress)) {
      const value = Math.max(this.lastProgress, Math.min(100, Math.round(progress)));
      this.lastProgress = value;
      if (this.percent) this.percent.textContent = `${value}%`;
      if (this.bar) this.bar.style.width = `${value}%`;
      this.root.style.setProperty('--loading-progress', `${value}%`);
    }
  }

  async complete() {
    if (!this.root) return;
    this.update('Mondo pronto', 100, 'Benvenuto nel Free Roam');
    await new Promise((resolve) => setTimeout(resolve, 180));
    this.root.classList.add('leaving');
    await new Promise((resolve) => setTimeout(resolve, 320));
    this.root.hidden = true;
    this.root.classList.remove('leaving');
  }

  hideImmediately() {
    if (!this.root) return;
    this.root.hidden = true;
    this.root.classList.remove('leaving');
  }
}
