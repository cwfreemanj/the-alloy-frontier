import { startServer } from './server';

const port = Number(process.env.PORT ?? 2567);
startServer(port).then((s) => console.log(`Alloy Frontier proof room listening on ws://127.0.0.1:${s.port}`));
