import http from 'node:http';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
const revision = readFileSync('.runtime-fixture/revision.txt', 'utf8').trim();
const replayMutationMarker = '.runtime-fixture/mutate-next-replay';
if (existsSync(replayMutationMarker)) { unlinkSync(replayMutationMarker); writeFileSync('.strategy-replay-mutated', 'mutated'); }
const server = http.createServer((_req, res) => { res.setHeader('x-engineeringos-revision', revision); res.end('runtime-ready'); });
server.listen(Number(process.env.PORT), '127.0.0.1');
process.once('SIGTERM', () => server.close(() => process.exit(0)));