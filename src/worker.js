import { parentPort } from 'worker_threads';

parentPort.on('message', (message) => {
  console.log(`Worker thread received message: ${message}`);
  parentPort.postMessage(`Worker thread received message: ${message}`);
});
