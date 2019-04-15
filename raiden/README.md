<h2 align="center">
  <br/>
  <a href='https://raiden.network/'><img 
      width='400px' 
      alt='' 
      src="https://user-images.githubusercontent.com/35398162/54018436-ee3f6300-4188-11e9-9b4e-0666c44cda53.png" /></a>
  <br/>
  Raiden Light Client SDK
  <br/>
</h2>

The Raiden Light Client SDK is a [Raiden Network](https://raiden.network) compatible client written in JavaScript/Typescript, capable of running in modern web3-enabled browsers, wallets and Node.js environments.

## About The Project

The [Raiden Network](https://raiden.network/) is an off-chain scaling solution, enabling near-instant, low-fee and scalable payments. It’s complementary to the Ethereum blockchain and works with any ERC20 compatible token.

The Raiden client code is available [here](https://github.com/raiden-network/raiden) and has been [released for mainnet](https://medium.com/raiden-network/red-eyes-mainnet-release-announcement-d48235bbef3c) with a limited alpha release of the Raiden Network in December 2018.

### Architecture diagram

```
            +---------+---------+
            |                   |
            |    Raiden SDK     |
            |                   |
            +----+----+----+----+
            |         |         |      +------------+
         +--+  redux  +  epics  +------+ Matrix.org |
         |  |         |         |      +-----+------+
         |  +---------+-----+---+            |
         |                  |          +-----+------+
+--------+-------+   +------+------+   |   Raiden   |
|  localStorage  |   |  ethers.js  |   |   Network  |
+----------------+   +------+------+   +------------+
                            |
                     +------+------+
                     |  ethereum   |
                     +-------------+
```

## Getting Started

```bash
npm install <raiden_npm_package>
```

Then in your JavaScript or TypeScript project:

```typescript
import { Raiden } from 'raiden';

# async factory
const raiden = await Raiden.create(web3.currentProvider, 0, localStorage);
```

This async factory is required as a lot of initialization code is asynchronous, and we want to provide simpler building blocks for you to get from zero to iterating with the Raiden Network through this SDK in the simplest way possible. Despite that, if you're brave enough or have the need, you can always create the instances and fill the constructor parameters by yourself. Just be very careful to persist and rehydrate the state and constants correctly before starting.

After you're done, you may want to call `raiden.stop()` to trigger all observables to complete and streams to be unsubscribed. It's not required though, as state changes are atomic (non-async) and Raiden can be rehydrated from any intermediary state. However, if you finish before an asynchronous operation was completed, you may need to re-send it. e.g. if you call `raiden.closeChannel` and your app exits before the transaction was sent and the promise resolved, your channel will be left in the `closing` state (as state was already notified and persisted that this channel was about to be closed and couldn't be used anymore), and you may need to call `closeChannel` again to actually send the transaction (even over the `closing` state) and wait until it is mined and your channel actually becomes `closed`.

Once you got your `raiden` instance, the public API should be pretty straightforward: most of the methods return Promises, allowing you to async/await on them, and output comes either from the resolved value or public Observables which exposes current state and state changes to the world on common parameters (like token address instead of specific token network contract address).

Channels are mostly specified through the first two parameters: `token` and `partner` addresses, as Raiden contracts currently limit the number of channels in open at any given time to some specific partner to 1.

### Subscribing to channel$ observable and opening your first channel

To connect to the Raiden Network, you simply make a transaction to open a channel on-chain with a given partner on a registered token network. You can also specify a `settleTimeout`, which will be the number of blocks you and your partner will need to wait after closing a channel to be able to settle it and actually get the due tokens back. `settleTimeout` defaults to `500`

```
import { RaidenChannels } from 'raiden';

# logs channels$ changes
raiden.channels$.subscribe((channels: RaidenChannels) => console.log('Raiden channels:', channels));

# get list of registered tokens
await raiden.getTokenList();
# ['0xtoken']

# open a Raiden payment channel!
const openTxHash = await raiden.openChannel('0xtoken', '0xpartner');

## output:
# Raiden channels: {
#   '0xtoken': {
#     '0xpartner': {
#       state: 'open',
#       totalDeposit: BigNumber(0),
#       partnerDeposit: BigNumber(0),
#       id: 123,
#       settleTimeout: 500,
#       openBlock: 5123
#     }
#   }
# }
```

### Funding a channel

If you intend to perform payments via a channel, you need to first lock a given amount of tokens in it. Note that these tokens aren't paid yet to the partner, and the custody is fully yours. It just locks this amount on-chain so your partner can be sure a given payment can be claimed.

```typescript
raiden.depositChannel('0xtoken', '0xpartner', 100);

# Raiden channels: {
#   '0xtoken': {
#     '0xpartner': {
#       state: 'closed',
#       totalDeposit: BigNumber(100),
#       partnerDeposit: BigNumber(0),
#       id: 123,
#       settleTimeout: 500,
#       openBlock: 5123
#     }
#   }
# }
```

### Paying through a channel

This is where the fun begins: off-chain payments! ...but we're still working on it on the Light Client ;)

### Closing a channel

Only close a channel if you really don't plan on using the respective channel anymore.

```typescript
await raiden.closeChannel('0xtoken', '0xpartner')
# resolves to close transaction hash, after it is mined

## channels$ output:
# Raiden channels: {
#   '0xtoken': {
#     '0xpartner': {
#       state: 'closed',
#       totalDeposit: BigNumber(100),
#       partnerDeposit: BigNumber(0),
#       id: 123,
#       settleTimeout: 500,
#       openBlock: 5123
#       closeBlock: 5999,
#     }
#   }
# }
```

### Settling a channel

As we can't perform a cooperative close yet, once your channel is closed, there is a grace period of `settleTimeout` blocks during which the counterpart can claim a higher signed balance proof sent by you. As the Light Client doesn't receive payments yet, there's no need to worry here, only the tokens you paid can be claimed by your partner. After `settleTimeout` blocks, your channel's state automatically becomes `settleable`, which is like `closed` but when settle can be called:

```typescript
await raiden.settleChannel('0xtoken', '0xpartner')
# resolves to settle transaction hash, after it is mined

## channels$ output:
# Raiden channels: {
#   '0xtoken': {}
# }
```

Once channel is settled, it's gone from state, and the cycle can restart.

### Other methods

There's a couple of more public methods exposed through main Raiden Light Client API. It aims to provide all necessary blockchain interaction methods and events related to Raiden, so you don't need to worry about web3 and Raiden contracts directly. Also, we're working on exposing more events and informational methods to the world, so stay tuned and keep an eye out for the main public API file: [raiden.ts]('./src/raiden.ts'). It's very easy to understand and docstrings are all over the place.


## Contributing

Any contributions you make are **greatly appreciated**. Refer to the [Raiden Light Client Development Guide](../CONTRIBUTING.md) for details on how to comply with our codestyle, patterns and quality requirements.

## License

Distributed under the [MIT License](../LICENSE).