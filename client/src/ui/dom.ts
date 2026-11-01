export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function toast(html: string, ms = 3500) {
  const box = document.getElementById('toasts')!;
  const t = el(`<div class="toast">${html}</div>`);
  box.appendChild(t);
  while (box.children.length > 4) box.firstElementChild!.remove();
  setTimeout(() => t.remove(), ms);
}

export const savedName = {
  get(): string {
    try {
      return localStorage.getItem('og-name') ?? '';
    } catch {
      return '';
    }
  },
  set(v: string) {
    try {
      localStorage.setItem('og-name', v);
    } catch {
      /* ignore */
    }
  }
};
