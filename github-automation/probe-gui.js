// Drives startGui() directly with a capture hook instead of main.js, so no
// browser window is opened and the URL is available. Hard watchdog.
import { pathToFileURL } from 'node:url';

const { startGui } = await import(pathToFileURL('D:\\dsh\\spacehog\\src\\gui\\server.js').href);

const watchdog = setTimeout(() => {
  console.log('WATCHDOG: 30s elapsed');
  process.exit(2);
}, 30_000);

let captured = null;
const { url, server } = await startGui({ open: async (u) => { captured = u; } });
console.log('captured url:', captured);
console.log('returned url:', url);

const post = async (path, body) => {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  console.log(`POST ${path} -> ${res.status}`);
  console.log((await res.text()).slice(0, 2500));
};

try {
  await post('api/run', { args: ['.', '--no-duplicates', '-n', '2'] });
} catch (error) {
  console.log('api/run failed:', error.name, error.message);
}

clearTimeout(watchdog);
server.close();
process.exit(0);
