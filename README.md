# Counterparty Transaction Parser

[![Tests](https://github.com/CounterpartyXCP/TxParser/actions/workflows/test.yml/badge.svg)](https://github.com/CounterpartyXCP/TxParser/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/CounterpartyXCP/TxParser/graph/badge.svg?token=45D6G1ESFV)](https://codecov.io/gh/CounterpartyXCP/TxParser)
![Node.js](https://img.shields.io/badge/node-20%20%7C%2022-brightgreen)

A TypeScript library for parsing Counterparty protocol transactions from Bitcoin blockchain data. Supports both legacy OP_RETURN and modern Taproot reveal formats.

## Features

- **OP_RETURN Parser**: Decode RC4-encrypted Counterparty messages from Bitcoin OP_RETURN outputs
- **Taproot Parser**: Extract Counterparty data from Taproot reveal transactions (witness scripts)
- **Complete Protocol Support**: Handles all major Counterparty message types
- **Type Safety**: Full TypeScript support with detailed type definitions

## Installation

```bash
npm install @counterpartyxcp/txparser
```

## Peer Dependencies

This library requires `bitcoinjs-lib` as a peer dependency:

```bash
npm install bitcoinjs-lib@^7.0.0-rc.0
```

## Usage

### Parsing OP_RETURN Transactions

```typescript
import { parse_op_return } from '@counterpartyxcp/txparser';
import * as btc from 'bitcoinjs-lib';

const scriptBuffer = Buffer.from('...'); // OP_RETURN script
const firstInputTxid = '...'; // Transaction ID of first input (used as RC4 key)
const network = btc.networks.bitcoin;

const result = parse_op_return(scriptBuffer, firstInputTxid, network);

if (result) {
  console.log('Message Type:', result.message_name);
  console.log('Message ID:', result.message_id);
  console.log('Parameters:', result.params);
}
```

### Parsing Taproot Reveal Transactions

```typescript
import { parse_reveal_tx } from '@counterpartyxcp/txparser';
import * as btc from 'bitcoinjs-lib';

const revealTxHex = '...'; // Raw transaction hex
const network = btc.networks.bitcoin;

const result = parse_reveal_tx(revealTxHex, network);

if (result) {
  console.log('Message Type:', result.message_name);
  console.log('Message ID:', result.message_id);
  console.log('Parameters:', result.params);
}
```

## Supported Message Types

The parser supports the following Counterparty message types:

- **Enhanced Send** (ID: 2) - Send assets with memo support
- **Sweep** (ID: 4) - Sweep all assets to an address
- **Order** (ID: 10) - Create decentralized exchange orders
- **BTC Pay** (ID: 11) - Bitcoin payment for orders
- **Dispenser** (ID: 12) - Create asset dispensers
- **Dispense** (ID: 13) - Trigger dispenser payment
- **Issuance** (ID: 20, 22) - Issue new assets
- **Issuance Subasset** (ID: 21, 23) - Issue subassets
- **Broadcast** (ID: 30) - Broadcast messages/data
- **Dividend** (ID: 50) - Pay dividends to asset holders
- **Cancel** (ID: 70) - Cancel open orders
- **Fairminter** (ID: 90) - Create fair minter
- **Fairmint** (ID: 91) - Mint from fair minter
- **Attach** (ID: 101) - Attach assets to UTXOs
- **Detach** (ID: 102) - Detach assets from UTXOs
- **Destroy** (ID: 110) - Destroy assets

## API Reference

### Types

```typescript
interface ParsedTransaction {
  message_name: string;
  message_id: number;
  params: TransactionPayload;
}

type TransactionPayload =
  | EnhancedSendPayload
  | SweepPayload
  | IssuancePayload
  | OrderPayload
  | BroadcastPayload
  | FairminterPayload
  | FairmintPayload
  | AttachPayload
  | DetachPayload
  | DispenserPayload
  | DispensePayload
  | DividendPayload
  | CancelPayload
  | DestroyPayload
  | UnknownPayload;
```

See [types.ts](./src/types.ts) for complete type definitions.

## Development

### Building

```bash
npm install
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Testing

The project includes a comprehensive test suite with **99.52% code coverage** and **100% line coverage**.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

See [tests/README.md](./tests/README.md) for detailed test documentation.

## Protocol Details

### OP_RETURN Format

Counterparty OP_RETURN messages are:

1. Encrypted with RC4 using the first input's transaction ID as the key
2. Prefixed with "CNTRPRTY" (8 bytes)
3. Followed by message type ID (1 or 4 bytes)
4. Followed by CBOR or binary-encoded payload

### Taproot Format

Taproot reveal transactions use witness scripts with envelope patterns:

- Generic envelope: `OP_FALSE OP_IF <data chunks> OP_ENDIF`
- Ord/XCP envelope: `OP_FALSE OP_IF "ord" "xcp" <metadata> <content> OP_ENDIF`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Links

- [Counterparty Data Encoding Specifications](https://docs.counterparty.io/docs/advanced/specifications/counterparty-data-encoding/)
- [Counterparty Protocol](https://counterparty.io/)
- [GitHub Repository](https://github.com/CounterpartyXCP/TxParser)
- [Issue Tracker](https://github.com/CounterpartyXCP/TxParser/issues)
