const fsPromises = require('fs').promises;
const path = require('path');
import { Server } from 'http';

import readline from 'readline-sync';
import { first } from 'rxjs/operators';
import yargs from 'yargs';
import { LocalStorage } from 'node-localstorage';
import { Wallet } from 'ethers';
import { BigNumberish } from 'ethers/utils';
import express, { Express } from 'express';

import { Raiden, RaidenChannel, RaidenTransfer } from 'raiden-ts';

let raiden: Raiden;
let app: Express;
let server: Server;
const globalThis = this;

async function waitStarted() {
  const start = Date.now();
  await raiden.action$.pipe(first(a => a.type === 'matrixSetup')).toPromise();
  await raiden.events$.pipe(first(a => a.type === 'newBlock')).toPromise();
  console.warn(
    'Started: #',
    await raiden.getBlockNumber(),
    new Date(),
    ', balance =',
    (await raiden.getBalance()).toString(),
    ', took',
    Date.now() - start,
  );
}

async function getChannel(token: string, partner: string) {
  const channels = await raiden.channels$.pipe(first()).toPromise();
  return channels?.[token]?.[partner];
}

async function channelOpen(token: string, partner: string) {
  const start = Date.now();
  let channel = await getChannel(token, partner);
  if (!channel) {
    await raiden.openChannel(token, partner);
    channel = await getChannel(token, partner);
    console.warn('Channel opened:', channel, ', took', Date.now() - start);
  } else {
    console.log('Channel already present:', channel);
  }
  return channel;
}

async function channelDeposit(channel: RaidenChannel, deposit: BigNumberish, mint?: boolean) {
  const start = Date.now();
  if (channel.ownDeposit.lt(deposit)) {
    const amount = channel.ownDeposit.sub(deposit).mul(-1);
    if (mint) {
      console.log('Minting:', amount.toString());
      await raiden.mint(channel.token, amount);
    }
    const tx = await raiden.depositChannel(channel.token, channel.partner, amount);
    console.warn('Channel deposited', tx, ', took', Date.now() - start);
  } else {
    console.log('Channel already funded:', channel.ownDeposit.toString());
  }
  return (await getChannel(channel.token, channel.partner)).ownDeposit.toString();
}

async function transfer(token: string, target: string, value: BigNumberish) {
  const start = Date.now();
  let revealAt: number;
  let unlockAt: number;
  const tId = await raiden.transfer(token, target, value);
  const t = await new Promise<RaidenTransfer>((resolve, reject) => {
    const sub = raiden.transfers$.subscribe(t => {
      if (t.secrethash !== tId) return;
      console.log('Transfer:', t);
      if (!revealAt && t.success !== undefined) revealAt = Date.now();
      if (!unlockAt && t.status.startsWith('UNLOCK')) unlockAt = Date.now();
      if (!t.completed) return;
      else if (t.success) resolve(t);
      else reject(t);
      sub.unsubscribe();
    });
  });
  console.warn(
    'Transfer: took total =',
    Date.now() - start,
    ', reveal =',
    revealAt! - start,
    ', unlock =',
    unlockAt! - start,
  );
  return t;
}

async function initRaiden({
  token,
  partner,
  deposit,
  mint,
  transfer: value,
  target,
}: {
  token?: string;
  partner?: string;
  deposit?: BigNumberish;
  mint?: boolean;
  transfer?: string;
  target?: string;
} = {}) {
  const start = Date.now();
  await waitStarted();

  if (token) {
    console.log('Token:', token, 'balance =', (await raiden.getTokenBalance(token)).toString());

    if (partner) {
      const channel = await channelOpen(token, partner);
      if (deposit) {
        await channelDeposit(channel, deposit, mint);
      }
    }

    if (value && target) {
      const availability = await raiden.getAvailability(target);
      if (!availability.available) {
        console.error('Target', target, 'not available:', availability);
      } else {
        await transfer(token, target, value);
      }
    }
  }
  console.warn('Init: took', Date.now() - start);
}

async function setupApi(port: number) {
  const api = '/api/v1';
  app = express();
  app.use(express.json());

  app.get(`${api}/channels`, ({}, res) => {
    raiden.channels$.pipe(first()).subscribe(c => res.json(c));
  });

  app.get(`${api}/address`, ({}, res) => {
    res.json({ our_address: raiden.address });
  });

  app.post(`${api}/payments/:token/:target`, async (req, res) => {
    console.log(
      `HTTP POST /payments: token="${req.params.token}", target="${req.params.target}", amount="${req.body.amount}"`,
    );
    const availability = await raiden.getAvailability(req.params.target);
    if (!availability.available) {
      res.status(400).json(availability);
    } else {
      transfer(req.params.token, req.params.target, req.body.amount).then(
        tr => {
          console.log('RaidenTransfer', tr);
          res.json(tr);
        },
        err => res.status(400).json(err),
      );
    }
  });

  app.post(`${api}/config`, (req, res) => {
    raiden.updateConfig(req.body.config);
    res.json(raiden.config);
  });

  return new Promise(
    resolve =>
      (server = app.listen(port, () => {
        console.log(`Serving Raiden LC API at http://localhost:${port}...`);
        resolve(app);
      })),
  );
}

async function main() {
  const argv = yargs
    .usage('Usage: $0 -k <private_json_path> -e <node_url> --serve <port>')
    .options({
      privateKey: {
        type: 'string',
        demandOption: true,
        alias: 'k',
        desc: 'JSON Private Key file path',
        coerce: path.resolve,
      },
      password: {
        type: 'string',
        desc:
          'JSON Private Key password. Better passed through "RAIDEN_PASSWORD" env var. Prompted if not provided',
      },
      ethNode: {
        alias: 'e',
        type: 'string',
        default: 'http://parity.goerli.ethnodes.brainbot.com:8545',
        desc: 'ETH JSON-RPC URL',
      },
      store: {
        alias: 's',
        type: 'string',
        default: './storage',
        desc: 'Dir path where to store state',
      },
      config: {
        alias: 'c',
        coerce: JSON.parse,
        desc: 'JSON to overwrite default/curretn config',
      },
      token: {
        type: 'string',
        desc: 'Token address to operate on',
      },
      partner: {
        type: 'string',
        desc: 'Open a channel with given partner',
        implies: 'token',
      },
      deposit: {
        type: 'string',
        desc: 'Deposit this value to channel with partner',
        implies: 'partner',
      },
      mint: {
        alias: 'm',
        type: 'boolean',
        desc: 'Mint amount to deposit',
        implies: 'deposit',
      },
      transfer: {
        type: 'string',
        desc: 'Transfer this amount to target',
        implies: 'token',
      },
      target: {
        type: 'string',
        desc: 'Transfer to this address',
        implies: 'transfer',
      },
      serve: {
        type: 'number',
        desc: 'Serve HTTP API on given port',
      },
    })
    .env('RAIDEN')
    .help().argv;

  if (!argv.password)
    argv.password = readline.question('Private Key Password: ', { hideEchoBack: true });

  const pk = await Wallet.fromEncryptedJson(
    await fsPromises.readFile(argv.privateKey, 'utf-8'),
    argv.password,
  );
  console.log('Address:', pk.address);

  const localStorage = new LocalStorage(argv.store);
  Object.assign(globalThis, { localStorage });

  raiden = await Raiden.create(argv.ethNode, pk.privateKey, localStorage, undefined, {
    ...argv.config,
    pfsSafetyMargin: 1.1,
    pfs: 'https://pfs.raidentransport.test001.env.raiden.network',
    matrixServer: 'https://raidentransport.test001.env.raiden.network',
  });

  process.on('SIGINT', () => {
    if (raiden.started === false) process.exit(1);
    console.log('Stopping...');
    if (server) server.close();
    raiden.stop();
  });

  const init = initRaiden(argv);
  raiden.start();
  try {
    await init;
    if (argv.serve) await setupApi(argv.serve);
  } finally {
    if (!argv.serve) {
      console.log('Stopping...');
      raiden.stop();
    }
  }
}

main();
