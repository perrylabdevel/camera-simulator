import './ui/styles.css';
import { App } from './ui/app';

const $ = (id: string) => document.getElementById(id)!;

async function main() {
  const loading = $('loading');
  const status = $('loading-text');
  try {
    const app = new App(
      $('evf') as HTMLCanvasElement,
      $('viewfinder'),
      $('evf-overlay'),
      $('evf-bar'),
      $('panel'),
      $('filmstrip'),
      $('review'),
    );
    await app.start((s) => (status.textContent = s));
    loading.classList.add('hidden');
    // Handy for debugging and automated screenshots.
    (window as unknown as { cameraApp: App }).cameraApp = app;
  } catch (err) {
    console.error(err);
    status.textContent = `Could not start the simulator: ${(err as Error).message}. A WebGL2-capable browser is required.`;
    loading.querySelector('.spinner')?.remove();
  }
}

void main();
