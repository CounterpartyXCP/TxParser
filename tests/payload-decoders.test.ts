import { describe, it, expect, vi } from 'vitest';
import { encode as cborEncode } from 'cbor-x';
import * as btc from 'bitcoinjs-lib';
import {
  assetIdToName,
  shortAddressBytesToAddress,
  decodeTextOrHex,
  readMessageTypeId,
  decodeEnhancedSend,
  decodeSweep,
  decodeIssuance,
  decodeIssuanceSubasset,
  decodeBroadcast,
  decodeFairminter,
  decodeFairmint,
  decodeAttach,
  decodeDetach,
  decodeOrder,
  decodeBtcPay,
  decodeDispenser,
  decodeDispense,
  decodeDividend,
  decodeCancel,
  decodeDestroy,
  decodePayload,
} from '../src/payload-decoders';

describe('assetIdToName', () => {
  it('should return BTC for asset ID 0', () => {
    expect(assetIdToName(0n)).toBe('BTC');
    expect(assetIdToName('0')).toBe('BTC');
  });

  it('should return XCP for asset ID 1', () => {
    expect(assetIdToName(1n)).toBe('XCP');
    expect(assetIdToName('1')).toBe('XCP');
  });

  it('should return numeric asset name for IDs below alphabetic threshold', () => {
    expect(assetIdToName(100n)).toBe('A100');
    expect(assetIdToName(17575n)).toBe('A17575'); // Just below 26^3
  });

  it('should return alphabetic name for IDs >= 26^3 and < 26^12 + 1', () => {
    // 26^3 = 17576 -> is the first alphabetic asset
    // The algorithm converts to base-26 alphabetic (1-based)
    expect(assetIdToName(17576n)).toBe('YYZ'); // 26^3 maps to YYZ in the algorithm
    
    // Test values within alphabetic range
    const alphabeticThreshold = BigInt(26) ** BigInt(3);
    expect(assetIdToName(alphabeticThreshold)).toBe('YYZ');
    expect(assetIdToName(alphabeticThreshold + 1n)).toBe('YZA');
  });

  it('should return numeric asset name for IDs >= 26^12 + 1', () => {
    const numericThreshold = BigInt(26) ** BigInt(12) + BigInt(1);
    expect(assetIdToName(numericThreshold)).toBe(`A${numericThreshold.toString()}`);
    expect(assetIdToName(numericThreshold + 1000n)).toBe(`A${(numericThreshold + 1000n).toString()}`);
  });
});

describe('shortAddressBytesToAddress', () => {
  const network = btc.networks.bitcoin;

  it('should convert P2PKH address (tag 0x01)', () => {
    // Create a P2PKH address for testing
    const hash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([0x01]), hash]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^1/); // P2PKH addresses start with '1'
  });

  it('should convert P2SH address (tag 0x02)', () => {
    const hash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([0x02]), hash]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^3/); // P2SH addresses start with '3'
  });

  it('should convert P2WPKH address (tag 0x03, version 0, 20 bytes)', () => {
    const hash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([0x03, 0x00]), hash]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^bc1/); // Bech32 addresses start with 'bc1'
  });

  it('should convert P2WSH address (tag 0x03, version 0, 32 bytes)', () => {
    const hash = Buffer.alloc(32, 0xef);
    const shortAddress = Buffer.concat([Buffer.from([0x03, 0x00]), hash]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^bc1/); // P2WSH Bech32 addresses
  });

  it('should return hex for invalid witness program (tag 0x03, invalid length)', () => {
    // Invalid witness program length (not 20 or 32 bytes for version 0)
    const hash = Buffer.alloc(10, 0xab);
    const shortAddress = Buffer.concat([Buffer.from([0x03, 0x00]), hash]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^0x/); // Should return hex for invalid witness program
  });

  it('should convert P2TR address (tag 0x03, version 1, 32 bytes)', () => {
    // Use a valid x-only pubkey for taproot (32 bytes)
    // Generate a valid taproot pubkey by removing the prefix byte from a compressed pubkey
    const validPubkey = Buffer.from('a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([0x03, 0x01]), validPubkey]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    // For taproot, bitcoinjs-lib may not create a valid address with arbitrary pubkey
    // The result should either be a bc1p address or return hex
    expect(result).toMatch(/^(bc1p|0x)/);
  });

  it('should return hex for tag 0x03 with insufficient data', () => {
    const shortAddress = Buffer.from([0x03, 0x00]);
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toBe(`0x${shortAddress.toString('hex')}`);
  });

  it('should handle segwit marker format (0x80 + witness version)', () => {
    const hash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([0x80]), hash]); // 0x80 = version 0
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^bc1/);
  });

  it('should handle P2WSH with segwit marker (0x80, 32 bytes)', () => {
    const hash = Buffer.alloc(32, 0xab);
    const shortAddress = Buffer.concat([Buffer.from([0x80]), hash]); // 0x80 = version 0, 32 bytes
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^bc1/); // P2WSH addresses
  });

  it('should handle P2TR with segwit marker (0x81, 32 bytes)', () => {
    const pubkey = Buffer.alloc(32, 0xcd);
    const shortAddress = Buffer.concat([Buffer.from([0x81]), pubkey]); // 0x81 = version 1
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    // May return bc1p or hex depending on pubkey validity
    expect(result).toMatch(/^(bc1p|0x)/);
  });

  it('should handle legacy Base58Check format', () => {
    const hash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([network.pubKeyHash]), hash]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^1/);
  });

  it('should handle legacy P2SH with scriptHash byte', () => {
    const hash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([network.scriptHash]), hash]);
    
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^3/); // P2SH addresses start with '3'
  });

  it('should fallback to hex for legacy format with invalid hash length', () => {
    const invalidHash = Buffer.alloc(10);
    const shortAddress = Buffer.concat([Buffer.from([network.pubKeyHash]), invalidHash]);
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toBe(`0x${shortAddress.toString('hex')}`);
  });

  it('should return hex for invalid short address', () => {
    const result = shortAddressBytesToAddress('ff', network);
    expect(result).toBe('0xff');
  });

  it('should return hex for unknown address format', () => {
    const shortAddress = Buffer.from([0xff, 0x12, 0x34]);
    const result = shortAddressBytesToAddress(shortAddress.toString('hex'), network);
    expect(result).toMatch(/^0x/);
  });
});

describe('decodeTextOrHex', () => {
  it('should decode as UTF-8 for empty mime type', () => {
    const buffer = Buffer.from('Hello World', 'utf8');
    const result = decodeTextOrHex(buffer, '');
    expect(result).toBe('Hello World');
  });

  it('should decode as UTF-8 for text mime type', () => {
    const buffer = Buffer.from('Test text', 'utf8');
    const result = decodeTextOrHex(buffer, 'text/plain');
    expect(result).toBe('Test text');
  });

  it('should return hex for non-text mime type', () => {
    const buffer = Buffer.from('binary data', 'utf8');
    const result = decodeTextOrHex(buffer, 'application/octet-stream');
    expect(result).toBe(buffer.toString('hex'));
  });

  it('should return hex for invalid UTF-8', () => {
    const buffer = Buffer.from([0xff, 0xfe, 0xfd]);
    const result = decodeTextOrHex(buffer, '');
    expect(result).toBe(buffer.toString('hex'));
  });
});

describe('readMessageTypeId', () => {
  it('should read short ID (1 byte)', () => {
    const buffer = Buffer.from([0x02, 0xaa, 0xbb, 0xcc]);
    const result = readMessageTypeId(buffer);
    expect(result.id).toBe(2);
    expect(result.rest).toEqual(Buffer.from([0xaa, 0xbb, 0xcc]));
  });

  it('should read long ID (4 bytes)', () => {
    const buffer = Buffer.alloc(10);
    buffer[0] = 0x00; // Marker for long ID
    buffer.writeUInt32BE(1234, 1);
    buffer[5] = 0xaa;
    
    const result = readMessageTypeId(buffer);
    expect(result.id).toBe(1234);
    expect(result.rest[0]).toBe(0xaa);
  });

  it('should throw error for empty message', () => {
    const buffer = Buffer.alloc(0);
    expect(() => readMessageTypeId(buffer)).toThrow('Empty message');
  });

  it('should throw error for too short long ID', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]); // Only 3 bytes, need 5
    expect(() => readMessageTypeId(buffer)).toThrow('Message too short for long ID');
  });
});

describe('decodeEnhancedSend', () => {
  const network = btc.networks.bitcoin;

  it('should decode valid enhanced send payload', () => {
    const assetId = 1n; // XCP
    const quantity = 1000;
    const addressHash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([0x01]), addressHash]);
    const memo = Buffer.from('test memo', 'utf8');
    
    const payload = cborEncode([assetId, quantity, shortAddress, memo]);
    const result = decodeEnhancedSend(payload, network);
    
    expect(result.asset).toBe('XCP');
    expect(result.quantity).toBe('1000');
    expect(result.address).toMatch(/^1/);
    expect(result.memo).toBe(memo.toString('hex'));
  });

  it('should decode enhanced send without memo', () => {
    const payload = cborEncode([1n, 500, Buffer.from([0x01, ...Array(20).fill(0xaa)])]);
    const result = decodeEnhancedSend(payload, network);
    
    expect(result.asset).toBe('XCP');
    expect(result.quantity).toBe('500');
    expect(result.memo).toBe('');
  });

  it('should decode enhanced send with non-Buffer address', () => {
    // Test the branch where decoded[2] is not a Buffer
    const payload = cborEncode([1n, 500, new Uint8Array([0x01, ...Array(20).fill(0xaa)])]);
    const result = decodeEnhancedSend(payload, network);
    
    expect(result.asset).toBe('XCP');
    expect(result.quantity).toBe('500');
  });

  it('should decode enhanced send with non-Buffer memo', () => {
    // Test the branch where memo is not a Buffer
    const payload = cborEncode([1n, 500, Buffer.from([0x01, ...Array(20).fill(0xaa)]), new Uint8Array([0x01, 0x02])]);
    const result = decodeEnhancedSend(payload, network);
    
    expect(result.memo).toBeDefined();
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = cborEncode([1n]); // Missing required fields
    expect(() => decodeEnhancedSend(invalidPayload, network)).toThrow('Invalid enhanced send payload');
  });
});

describe('decodeSweep', () => {
  const network = btc.networks.bitcoin;

  it('should decode valid sweep payload', () => {
    const addressHash = Buffer.from('89abcdefabbaabbaabbaabbaabbaabbaabbaabba', 'hex');
    const shortAddress = Buffer.concat([Buffer.from([0x01]), addressHash]);
    const flags = 1;
    const memo = Buffer.from('sweep memo', 'utf8');
    
    const payload = cborEncode([shortAddress, flags, memo]);
    const result = decodeSweep(payload, network);
    
    expect(result.address).toMatch(/^1/);
    expect(result.flags).toBe(1);
    expect(result.memo).toBe(memo.toString('hex'));
  });

  it('should decode sweep without memo', () => {
    const payload = cborEncode([Buffer.from([0x01, ...Array(20).fill(0xaa)]), 0]);
    const result = decodeSweep(payload, network);
    
    expect(result.flags).toBe(0);
    expect(result.memo).toBe('');
  });

  it('should decode sweep with non-Buffer address', () => {
    const payload = cborEncode([new Uint8Array([0x01, ...Array(20).fill(0xaa)]), 0]);
    const result = decodeSweep(payload, network);
    
    expect(result.flags).toBe(0);
  });

  it('should decode sweep with non-Buffer memo', () => {
    const payload = cborEncode([Buffer.from([0x01, ...Array(20).fill(0xaa)]), 1, new Uint8Array([0xaa, 0xbb])]);
    const result = decodeSweep(payload, network);
    
    expect(result.memo).toBeDefined();
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = cborEncode([Buffer.from([0x01])]);
    expect(() => decodeSweep(invalidPayload, network)).toThrow('Invalid sweep payload');
  });
});

describe('decodeIssuance', () => {
  it('should decode valid issuance payload', () => {
    const assetId = 17576n; // First alphabetic asset (YYZ)
    const quantity = 1000000;
    const divisible = true;
    const lock = false;
    const reset = false;
    const mimeType = 'text/plain';
    const description = Buffer.from('Test Asset', 'utf8');
    
    const payload = cborEncode([assetId, quantity, divisible, lock, reset, mimeType, description]);
    const result = decodeIssuance(payload);
    
    expect(result.asset).toBe('YYZ');
    expect(result.quantity).toBe('1000000');
    expect(result.divisible).toBe(true);
    expect(result.lock).toBe(false);
    expect(result.reset).toBe(false);
    expect(result.mime_type).toBe('text/plain');
    expect(result.description).toBe('Test Asset');
  });

  it('should decode issuance without description', () => {
    const payload = cborEncode([100n, 1000, true, false, false, '']);
    const result = decodeIssuance(payload);
    
    expect(result.asset).toBe('A100');
    expect(result.description).toBe(null);
  });

  it('should decode issuance with binary description', () => {
    const payload = cborEncode([100n, 1000, true, false, false, 'application/octet-stream', Buffer.from([0xff, 0xaa])]);
    const result = decodeIssuance(payload);
    
    expect(result.mime_type).toBe('application/octet-stream');
    expect(result.description).toBe('ffaa');
  });

  it('should decode issuance with typed-array description', () => {
    const payload = cborEncode([
      17576n,
      1000,
      true,
      false,
      false,
      'text/plain',
      new Uint8Array(Buffer.from('Typed issuance', 'utf8'))
    ]);
    const result = decodeIssuance(payload);
    expect(result.description).toBe('Typed issuance');
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = cborEncode([100n, 1000]);
    expect(() => decodeIssuance(invalidPayload)).toThrow('Invalid issuance payload');
  });
});

describe('decodeIssuanceSubasset', () => {
  it('should decode valid issuance subasset payload', () => {
    const assetId = 17576n; // First alphabetic asset
    const quantity = 1000;
    const divisible = 1;
    const lock = 0;
    const reset = 0;
    const compactedLength = 10;
    const compactedName = Buffer.from('subasset', 'utf8');
    const mimeType = 'text/plain';
    const description = Buffer.from('Subasset description', 'utf8');
    
    const payload = cborEncode([assetId, quantity, divisible, lock, reset, compactedLength, compactedName, mimeType, description]);
    const result = decodeIssuanceSubasset(payload);
    
    expect(result.asset).toBe('YYZ');
    expect(result.quantity).toBe('1000');
    expect(result.divisible).toBe(1);
    expect(result.compacted_subasset_length).toBe(10);
    expect(result.compacted_subasset_longname).toBe(compactedName.toString('hex'));
    expect(result.description).toBe('Subasset description');
  });

  it('should decode issuance subasset without description', () => {
    const payload = cborEncode([
      17576n,
      1000,
      1,
      0,
      0,
      10,
      Buffer.from('subasset', 'utf8'),
      'text/plain'
    ]);
    const result = decodeIssuanceSubasset(payload);
    expect(result.description).toBe(null);
  });

  it('should decode issuance subasset with typed-array description', () => {
    const payload = cborEncode([
      17576n,
      1000,
      1,
      0,
      0,
      10,
      Buffer.from('subasset', 'utf8'),
      'text/plain',
      new Uint8Array(Buffer.from('typed subasset', 'utf8'))
    ]);
    const result = decodeIssuanceSubasset(payload);
    expect(result.description).toBe('typed subasset');
  });

  it('should decode issuance subasset with typed-array fields', () => {
    const payload = cborEncode([
      17576n,
      1000,
      1,
      0,
      0,
      10,
      new Uint8Array(Buffer.from('subasset', 'utf8')),
      'text/plain',
      new Uint8Array(Buffer.from('typed subasset', 'utf8'))
    ]);
    const result = decodeIssuanceSubasset(payload);
    expect(result.compacted_subasset_longname).toBe(Buffer.from('subasset', 'utf8').toString('hex'));
    expect(result.description).toBe('typed subasset');
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = cborEncode([100n, 1000, 1]);
    expect(() => decodeIssuanceSubasset(invalidPayload)).toThrow('Invalid issuance subasset payload');
  });
});

describe('decodeBroadcast', () => {
  it('should decode valid broadcast payload', () => {
    const timestamp = 1234567890;
    const value = 1.5;
    const feeFraction = 5000000;
    const mimeType = 'text/plain';
    const text = Buffer.from('Broadcast message', 'utf8');
    
    const payload = cborEncode([timestamp, value, feeFraction, mimeType, text]);
    const result = decodeBroadcast(payload);
    
    expect(result.timestamp).toBe(timestamp);
    expect(result.value).toBe(value);
    expect(result.fee_fraction_int).toBe(feeFraction);
    expect(result.mime_type).toBe('text/plain');
    expect(result.text).toBe('Broadcast message');
  });

  it('should decode broadcast without text', () => {
    const payload = cborEncode([123456, 0.5, 1000000, '']);
    const result = decodeBroadcast(payload);
    
    expect(result.text).toBe('');
  });

  it('should decode broadcast text from typed array', () => {
    const payload = cborEncode([1234567890, 2.5, 2500000, 'text/plain', new Uint8Array(Buffer.from('Typed text', 'utf8'))]);
    const result = decodeBroadcast(payload);
    expect(result.text).toBe('Typed text');
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = cborEncode([123, 0.5]);
    expect(() => decodeBroadcast(invalidPayload)).toThrow('Invalid broadcast payload');
  });
});

describe('decodeFairminter', () => {
  it('should decode valid fairminter payload', () => {
    const assetId = 1000n;
    const assetParentId = 17576n; // First alphabetic asset
    const fields = [
      assetId, assetParentId, '1000', '100', '10', '50', '1000', '0',
      100, 200, '500', 150, 5000000, true, false, true, true, 'text/plain', Buffer.from('Fair minter', 'utf8')
    ];
    
    const payload = cborEncode(fields);
    const result = decodeFairminter(payload);
    
    expect(result.asset).toBe('A1000');
    expect(result.asset_parent).toBe('YYZ');
    expect(result.price).toBe('1000');
    expect(result.divisible).toBe(true);
    expect(result.description).toBe('Fair minter');
  });

  it('should handle fairminter payload without description', () => {
    const fields = [
      1n, 0n, '10', '5', '1', '2', '100', '0',
      10, 20, '30', 40, 5000, false, true, false, false, ''
    ];

    const payload = cborEncode(fields);
    const result = decodeFairminter(payload);

    expect(result.description).toBe('');
    expect(result.mime_type).toBe('');
  });

  it('should handle fairminter payload with typed-array description', () => {
    const description = new Uint8Array(Buffer.from('typed desc', 'utf8'));
    const fields = [
      2n, 1n, '20', '10', '2', '3', '200', '0',
      11, 21, '31', 41, 6000, true, false, true, true, 'text/plain', description
    ];

    const payload = cborEncode(fields);
    const result = decodeFairminter(payload);

    expect(result.description).toBe('typed desc');
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = cborEncode([1000n, 26n]);
    expect(() => decodeFairminter(invalidPayload)).toThrow('Invalid fairminter payload');
  });
});

describe('decodeFairmint', () => {
  it('should decode valid fairmint payload', () => {
    const assetId = 1000n;
    const quantity = 500;
    
    const payload = cborEncode([assetId, quantity]);
    const result = decodeFairmint(payload);
    
    expect(result.asset).toBe('A1000');
    expect(result.quantity).toBe('500');
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = cborEncode([1000n]);
    expect(() => decodeFairmint(invalidPayload)).toThrow('Invalid fairmint payload');
  });
});

describe('decodeAttach', () => {
  it('should decode valid attach payload', () => {
    const payload = Buffer.from('XCP|1000|0', 'utf8');
    const result = decodeAttach(payload);
    
    expect(result.asset).toBe('XCP');
    expect(result.quantity).toBe('1000');
    expect(result.destination_vout).toBe('0');
  });

  it('should decode attach without destination_vout', () => {
    const payload = Buffer.from('MYASSET|500', 'utf8');
    const result = decodeAttach(payload);
    
    expect(result.asset).toBe('MYASSET');
    expect(result.quantity).toBe('500');
    expect(result.destination_vout).toBe('');
  });

  it('should fallback to empty strings when fields are missing', () => {
    const assetMissing = Buffer.from('|250|1', 'utf8');
    const resultAssetMissing = decodeAttach(assetMissing);
    expect(resultAssetMissing.asset).toBe('');
    expect(resultAssetMissing.quantity).toBe('250');

    const quantityMissing = Buffer.from('ASSET||1', 'utf8');
    const resultQuantityMissing = decodeAttach(quantityMissing);
    expect(resultQuantityMissing.quantity).toBe('');
  });

  it('should throw error for invalid payload', () => {
    const payload = Buffer.from('INVALID', 'utf8');
    expect(() => decodeAttach(payload)).toThrow('Invalid attach payload');
  });
});

describe('decodeDetach', () => {
  it('should decode self destination (0x30)', () => {
    const payload = Buffer.from([0x30]);
    const result = decodeDetach(payload);
    
    expect(result.destination).toBe('self');
  });

  it('should decode address destination', () => {
    const payload = Buffer.from('bc1qtest123address', 'utf8');
    const result = decodeDetach(payload);
    
    expect(result.destination).toBe('bc1qtest123address');
  });
});

describe('decodeOrder', () => {
  it('should decode valid order payload', () => {
    const buffer = Buffer.alloc(42);
    buffer.writeBigUInt64BE(0n, 0); // give_id: BTC
    buffer.writeBigInt64BE(1000n, 8); // give_quantity
    buffer.writeBigUInt64BE(1n, 16); // get_id: XCP
    buffer.writeBigInt64BE(500n, 24); // get_quantity
    buffer.writeUInt16BE(100, 32); // expiration
    buffer.writeBigInt64BE(10n, 34); // fee_required
    
    const result = decodeOrder(buffer);
    
    expect(result.give_asset).toBe('BTC');
    expect(result.give_quantity).toBe('1000');
    expect(result.get_asset).toBe('XCP');
    expect(result.get_quantity).toBe('500');
    expect(result.expiration).toBe(100);
    expect(result.fee_required).toBe('10');
  });

  it('should decode order without fee_required', () => {
    const buffer = Buffer.alloc(34);
    buffer.writeBigUInt64BE(1n, 0);
    buffer.writeBigInt64BE(100n, 8);
    buffer.writeBigUInt64BE(0n, 16);
    buffer.writeBigInt64BE(10000n, 24);
    buffer.writeUInt16BE(50, 32);
    
    const result = decodeOrder(buffer);
    
    expect(result.fee_required).toBe('0');
  });

  it('should throw error for invalid payload', () => {
    const buffer = Buffer.alloc(10);
    expect(() => decodeOrder(buffer)).toThrow('Invalid order payload');
  });
});

describe('decodeBtcPay', () => {
  it('should decode valid btc_pay payload', () => {
    const tx0Hash = Buffer.alloc(32, 0xaa);
    const tx1Hash = Buffer.alloc(32, 0xbb);
    const payload = Buffer.concat([tx0Hash, tx1Hash]);
    
    const result = decodeBtcPay(payload);
    
    expect(result.tx0_hash).toBe(tx0Hash.toString('hex'));
    expect(result.tx1_hash).toBe(tx1Hash.toString('hex'));
  });

  it('should throw error for invalid payload', () => {
    const buffer = Buffer.alloc(32);
    expect(() => decodeBtcPay(buffer)).toThrow('Invalid btc_pay payload');
  });
});

describe('decodeDispenser', () => {
  const network = btc.networks.bitcoin;

  it('should decode valid dispenser payload without addresses', () => {
    const buffer = Buffer.alloc(33);
    buffer.writeBigUInt64BE(1n, 0); // asset_id: XCP
    buffer.writeBigInt64BE(100n, 8); // give_quantity
    buffer.writeBigInt64BE(1000n, 16); // escrow_quantity
    buffer.writeBigInt64BE(5000n, 24); // satoshirate
    buffer.writeUInt8(1, 32); // status
    
    const result = decodeDispenser(buffer, network);
    
    expect(result.asset).toBe('XCP');
    expect(result.give_quantity).toBe('100');
    expect(result.escrow_quantity).toBe('1000');
    expect(result.satoshirate).toBe('5000');
    expect(result.status).toBe(1);
    expect(result.action_address).toBeUndefined();
  });

  it('should decode dispenser with action and oracle addresses', () => {
    const buffer = Buffer.alloc(75);
    buffer.writeBigUInt64BE(1n, 0);
    buffer.writeBigInt64BE(100n, 8);
    buffer.writeBigInt64BE(1000n, 16);
    buffer.writeBigInt64BE(5000n, 24);
    buffer.writeUInt8(1, 32);
    
    // Add action address (21 bytes)
    const actionAddress = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(20, 0xaa)]);
    actionAddress.copy(buffer, 33);
    
    // Add oracle address (21 bytes)
    const oracleAddress = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(20, 0xbb)]);
    oracleAddress.copy(buffer, 54);
    
    const result = decodeDispenser(buffer, network);
    
    expect(result.action_address).toBeDefined();
    expect(result.oracle_address).toBeDefined();
  });

  it('should decode dispenser with only action address', () => {
    const buffer = Buffer.alloc(54);
    buffer.writeBigUInt64BE(1n, 0);
    buffer.writeBigInt64BE(100n, 8);
    buffer.writeBigInt64BE(1000n, 16);
    buffer.writeBigInt64BE(5000n, 24);
    buffer.writeUInt8(1, 32);

    const actionAddress = Buffer.concat([Buffer.from([0x01]), Buffer.alloc(20, 0xaa)]);
    actionAddress.copy(buffer, 33);

    const result = decodeDispenser(buffer, network);

    expect(result.action_address).toBeDefined();
    expect(result.oracle_address).toBeUndefined();
  });

  it('should throw error for invalid payload', () => {
    const buffer = Buffer.alloc(10);
    expect(() => decodeDispenser(buffer, network)).toThrow('Invalid dispenser payload');
  });
});

describe('decodeDispense', () => {
  it('should decode valid dispense payload', () => {
    const payload = Buffer.from([0x00]);
    const result = decodeDispense(payload);
    
    expect(result.data).toBe('0x00');
  });

  it('should throw error for invalid payload', () => {
    const invalidPayload = Buffer.from([0x01]);
    expect(() => decodeDispense(invalidPayload)).toThrow('Invalid dispense payload: expected 0x00');
  });

  it('should throw error for empty payload', () => {
    const emptyPayload = Buffer.alloc(0);
    expect(() => decodeDispense(emptyPayload)).toThrow('Invalid dispense payload: expected 0x00');
  });
});

describe('decodeDividend', () => {
  it('should decode dividend with dividend_asset_id', () => {
    const buffer = Buffer.alloc(24);
    buffer.writeBigInt64BE(1000n, 0); // quantity_per_unit
    buffer.writeBigUInt64BE(1n, 8); // asset_id: XCP
    buffer.writeBigUInt64BE(0n, 16); // dividend_asset_id: BTC
    
    const result = decodeDividend(buffer);
    
    expect(result.quantity_per_unit).toBe('1000');
    expect(result.asset).toBe('XCP');
    expect(result.dividend_asset).toBe('BTC');
  });

  it('should decode dividend without dividend_asset_id (defaults to XCP)', () => {
    const buffer = Buffer.alloc(16);
    buffer.writeBigInt64BE(500n, 0);
    buffer.writeBigUInt64BE(17576n, 8); // First alphabetic asset
    
    const result = decodeDividend(buffer);
    
    expect(result.quantity_per_unit).toBe('500');
    expect(result.asset).toBe('YYZ');
    expect(result.dividend_asset).toBe('XCP');
  });

  it('should throw error for invalid payload', () => {
    const buffer = Buffer.alloc(8);
    expect(() => decodeDividend(buffer)).toThrow('Invalid dividend payload');
  });
});

describe('decodeCancel', () => {
  it('should decode valid cancel payload', () => {
    const offerHash = Buffer.alloc(32, 0xcc);
    const result = decodeCancel(offerHash);
    
    expect(result.offer_hash).toBe(offerHash.toString('hex'));
  });

  it('should throw error for invalid payload', () => {
    const buffer = Buffer.alloc(16);
    expect(() => decodeCancel(buffer)).toThrow('Invalid cancel payload');
  });
});

describe('decodeDestroy', () => {
  it('should decode destroy without tag', () => {
    const buffer = Buffer.alloc(16);
    buffer.writeBigUInt64BE(1n, 0); // asset_id: XCP
    buffer.writeBigInt64BE(100n, 8); // quantity
    
    const result = decodeDestroy(buffer);
    
    expect(result.asset).toBe('XCP');
    expect(result.quantity).toBe('100');
    expect(result.tag).toBeUndefined();
  });

  it('should decode destroy with tag', () => {
    const buffer = Buffer.alloc(20);
    buffer.writeBigUInt64BE(17576n, 0); // First alphabetic asset
    buffer.writeBigInt64BE(50n, 8);
    buffer.writeUInt32BE(0xdeadbeef, 16);
    
    const result = decodeDestroy(buffer);
    
    expect(result.asset).toBe('YYZ');
    expect(result.quantity).toBe('50');
    expect(result.tag).toBeDefined();
  });

  it('should throw error for invalid payload', () => {
    const buffer = Buffer.alloc(8);
    expect(() => decodeDestroy(buffer)).toThrow('Invalid destroy payload');
  });
});

describe('decodePayload', () => {
  const network = btc.networks.bitcoin;

  it('should route to correct decoder for Enhanced Send (ID 2)', () => {
    const payload = cborEncode([1n, 1000, Buffer.from([0x01, ...Array(20).fill(0xaa)])]);
    const result = decodePayload(2, payload, network);
    
    expect(result).toHaveProperty('asset');
    expect(result).toHaveProperty('quantity');
  });

  it('should route to correct decoder for Order (ID 10)', () => {
    const buffer = Buffer.alloc(34);
    buffer.writeBigUInt64BE(0n, 0);
    buffer.writeBigInt64BE(1000n, 8);
    buffer.writeBigUInt64BE(1n, 16);
    buffer.writeBigInt64BE(500n, 24);
    buffer.writeUInt16BE(100, 32);
    
    const result = decodePayload(10, buffer, network);
    
    expect(result).toHaveProperty('give_asset');
    expect(result).toHaveProperty('get_asset');
  });

  it('should return raw hex for unknown message type', () => {
    const payload = Buffer.from([0xaa, 0xbb, 0xcc]);
    const result = decodePayload(999, payload, network);
    
    expect(result).toHaveProperty('raw');
    expect((result as any).raw).toBe('aabbcc');
  });

  it('should return raw hex with error on decode failure', () => {
    const invalidPayload = Buffer.from([0x01]); // Invalid CBOR for Enhanced Send
    const result = decodePayload(2, invalidPayload, network);
    
    expect(result).toHaveProperty('raw');
    expect(result).toHaveProperty('error');
  });

  it('should return raw hex with unknown error when decoder throws non-error', () => {
    const payload = cborEncode([1n, 500, new Uint8Array([0x01, ...Array(20).fill(0xaa)])]);

    const originalBufferFrom = Buffer.from;
    (Buffer as any).from = () => {
      throw 'buffer failure';
    };

    try {
      const result = decodePayload(2, payload, btc.networks.bitcoin);
      expect(result).toEqual({ raw: payload.toString('hex'), error: 'Unknown error' });
    } finally {
      Buffer.from = originalBufferFrom;
    }
  });

  it('should handle all message types', () => {
    // Test that all message types route correctly
    const messageTypes = [2, 4, 10, 11, 12, 13, 20, 21, 22, 23, 30, 50, 70, 90, 91, 101, 102, 110];
    
    messageTypes.forEach(type => {
      const payload = Buffer.from([0x01]); // Invalid but will be caught
      const result = decodePayload(type, payload, network);
      
      // Should either decode successfully or return error with raw
      expect(result).toBeDefined();
    });
  });
});

