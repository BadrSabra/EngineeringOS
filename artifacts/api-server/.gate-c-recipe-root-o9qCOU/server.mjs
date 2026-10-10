import http from 'node:http';
import { readFileSync } from 'node:fs';
const revision = readFileSync('node_modules/.cache/revision.txt', 'utf8').trim();
const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', revision); res.end('runtime-ready'); });
server.listen(Number(process.env.PORT), '127.0.0.1');
process.once('SIGTERM', () => server.close(() => process.exit(0)));